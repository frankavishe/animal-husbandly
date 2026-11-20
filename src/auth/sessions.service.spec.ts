import { UnauthorizedException } from '@nestjs/common';
import { SessionsService } from './sessions.service';

const USER = '11111111-1111-4111-8111-111111111111';

function makePrisma() {
  const session = {
    create: jest.fn(({ data }) => Promise.resolve({ ...data, createdAt: new Date() })),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const prisma: any = {
    session,
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  return prisma;
}

const config: any = { get: jest.fn(() => 7) };

describe('SessionsService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: SessionsService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SessionsService(prisma, config);
  });

  async function issue() {
    const issued = await service.create(USER, { userAgent: 'jest', ip: '127.0.0.1' });
    const stored = prisma.session.create.mock.calls.at(-1)[0].data;
    return { issued, stored };
  }

  it('creates `<id>.<secret>` tokens and stores only the SHA-256 of the secret', async () => {
    const { issued, stored } = await issue();
    const [id, secret] = issued.refreshToken.split('.');
    expect(id).toBe(stored.id);
    expect(stored.tokenHash).toBe(SessionsService.hash(secret));
    expect(stored.tokenHash).not.toContain(secret);
    const days = (stored.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('parse rejects malformed tokens', () => {
    expect(SessionsService.parse('nope')).toBeNull();
    expect(SessionsService.parse('.secret')).toBeNull();
    expect(SessionsService.parse('not-a-uuid.secretsecretsecretsecret')).toBeNull();
    expect(SessionsService.parse(`${USER}.short`)).toBeNull();
  });

  it('rotate spends the token and issues a new one', async () => {
    const { issued, stored } = await issue();
    prisma.session.findUnique.mockResolvedValue({ ...stored, usedAt: null, revokedAt: null });
    prisma.session.updateMany.mockResolvedValue({ count: 1 });

    const next = await service.rotate(issued.refreshToken);

    expect(next.refreshToken).not.toBe(issued.refreshToken);
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { id: stored.id, usedAt: null, revokedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it.each(['usedAt', 'revokedAt'])(
    'rotate of a token with %s set revokes all sessions and throws 401',
    async (field) => {
      const { issued, stored } = await issue();
      prisma.session.findUnique.mockResolvedValue({
        ...stored,
        usedAt: null,
        revokedAt: null,
        [field]: new Date(),
      });
      prisma.session.updateMany.mockResolvedValue({ count: 2 });

      await expect(service.rotate(issued.refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { userId: USER, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.session.create).toHaveBeenCalledTimes(1); // only the original
    },
  );

  it('rotate losing a concurrent race is treated as replay', async () => {
    const { issued, stored } = await issue();
    prisma.session.findUnique.mockResolvedValue({ ...stored, usedAt: null, revokedAt: null });
    prisma.session.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });

    await expect(service.rotate(issued.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.session.updateMany).toHaveBeenLastCalledWith({
      where: { userId: USER, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rotate rejects expired tokens without revoking others', async () => {
    const { issued, stored } = await issue();
    prisma.session.findUnique.mockResolvedValue({
      ...stored,
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.rotate(issued.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it('rotate rejects a forged secret for a real session id without revoking', async () => {
    const { stored } = await issue();
    prisma.session.findUnique.mockResolvedValue({ ...stored, usedAt: null, revokedAt: null });
    await expect(
      service.rotate(`${stored.id}.forgedforgedforgedforgedforged`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.session.updateMany).not.toHaveBeenCalled();
  });

  it('revoke is silent for unknown tokens', async () => {
    prisma.session.findUnique.mockResolvedValue(null);
    await expect(service.revoke(`${USER}.whateverwhateverwhatever`)).resolves.toBeUndefined();
    expect(prisma.session.update).not.toHaveBeenCalled();
  });

  it('revokeAll can keep the current session', async () => {
    prisma.session.updateMany.mockResolvedValue({ count: 3 });
    await service.revokeAll(USER, 'keep-me');
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: USER, revokedAt: null, id: { not: 'keep-me' } },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
