import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

const config: any = {
  get: jest.fn((key: string) => ({ BCRYPT_ROUNDS: 4, JWT_ACCESS_TTL: 900 })[key]),
};

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    fullName: 'Juma',
    phone: '+255712345678',
    email: null,
    passwordHash: bcrypt.hashSync('Secret123', 4),
    role: Role.CUSTOMER,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  let users: any;
  let sessions: any;
  let jwt: any;
  let service: AuthService;

  beforeEach(() => {
    users = {
      create: jest.fn(),
      findByIdentifier: jest.fn(),
      findById: jest.fn(),
      getById: jest.fn(),
      updatePasswordHash: jest.fn(),
    };
    sessions = {
      create: jest.fn().mockResolvedValue({ session: { id: 's1' }, refreshToken: 's1.secret' }),
      rotate: jest.fn(),
      revoke: jest.fn(),
      revokeAll: jest.fn(),
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('access.jwt') };
    service = new AuthService(users, sessions, jwt, config);
  });

  it('register hashes the password, never assigns another role, and returns a session', async () => {
    users.create.mockImplementation((input: any) => Promise.resolve(user(input)));
    const res = await service.register(
      { fullName: 'Juma', phone: '+255712345678', password: 'Secret123' },
      {},
    );
    const input = users.create.mock.calls[0][0];
    expect(input.role).toBeUndefined();
    expect(input.passwordHash).not.toBe('Secret123');
    expect(await bcrypt.compare('Secret123', input.passwordHash)).toBe(true);
    expect(res).toMatchObject({ accessToken: 'access.jwt', refreshToken: 's1.secret' });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'u1', role: 'CUSTOMER', sid: 's1' });
  });

  it('login succeeds with the right password', async () => {
    users.findByIdentifier.mockResolvedValue(user());
    const res = await service.login({ identifier: '0712345678', password: 'Secret123' }, {});
    expect(res.user).toMatchObject({ id: 'u1' });
    expect((res.user as any).passwordHash).toBeUndefined();
  });

  it('login gives the same generic error for unknown user and wrong password', async () => {
    users.findByIdentifier.mockResolvedValue(null);
    await expect(service.login({ identifier: 'x', password: 'Secret123' }, {})).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
    users.findByIdentifier.mockResolvedValue(user());
    await expect(service.login({ identifier: 'x', password: 'Wrong123' }, {})).rejects.toThrow(
      new UnauthorizedException('Invalid credentials'),
    );
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('login refuses deactivated accounts with 403', async () => {
    users.findByIdentifier.mockResolvedValue(user({ isActive: false }));
    await expect(
      service.login({ identifier: 'x', password: 'Secret123' }, {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refresh refuses deactivated accounts and revokes their sessions', async () => {
    sessions.rotate.mockResolvedValue({ session: { id: 's2', userId: 'u1' }, refreshToken: 't' });
    users.findById.mockResolvedValue(user({ isActive: false }));
    await expect(service.refresh('t', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(sessions.revokeAll).toHaveBeenCalledWith('u1');
  });

  it('changePassword verifies the current password and revokes other sessions', async () => {
    users.getById.mockResolvedValue(user());
    await expect(
      service.changePassword(
        { id: 'u1', role: Role.CUSTOMER, sessionId: 's1' },
        { currentPassword: 'Wrong123', newPassword: 'NewPass456' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.changePassword(
      { id: 'u1', role: Role.CUSTOMER, sessionId: 's1' },
      { currentPassword: 'Secret123', newPassword: 'NewPass456' },
    );
    const newHash = users.updatePasswordHash.mock.calls[0][1];
    expect(await bcrypt.compare('NewPass456', newHash)).toBe(true);
    expect(sessions.revokeAll).toHaveBeenCalledWith('u1', 's1');
  });
});
