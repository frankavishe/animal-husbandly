import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminUsersService } from './admin-users.service';

const target = {
  id: 'u2',
  fullName: 'Neema',
  phone: '+255712345678',
  email: null,
  passwordHash: 'h',
  role: Role.CUSTOMER,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AdminUsersService', () => {
  let prisma: any;
  let users: any;
  let sessions: any;
  let service: AdminUsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([target]),
        count: jest.fn().mockResolvedValue(41),
        update: jest.fn(({ data }) => Promise.resolve({ ...target, ...data })),
      },
      $transaction: jest.fn((arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };
    users = { getById: jest.fn().mockResolvedValue(target) };
    sessions = { revokeAll: jest.fn() };
    service = new AdminUsersService(prisma, users, sessions);
  });

  it('paginates and builds filters', async () => {
    const res = await service.list({
      page: 3,
      limit: 20,
      role: Role.CUSTOMER,
      isActive: true,
      search: '0712345678',
    });
    expect(res).toMatchObject({ page: 3, limit: 20, total: 41, totalPages: 3 });
    expect(res.items[0]).not.toHaveProperty('passwordHash');
    const args = prisma.user.findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 40, take: 20 });
    expect(args.where).toMatchObject({ role: Role.CUSTOMER, isActive: true });
    expect(args.where.OR).toContainEqual({ phone: { contains: '+255712345678' } });
  });

  it('refuses to change own status', async () => {
    await expect(service.setStatus('u2', 'u2', false)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('404s for an unknown user', async () => {
    users.getById.mockRejectedValue(new NotFoundException());
    await expect(service.setStatus('admin', 'nope', false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deactivation revokes all sessions in the same transaction', async () => {
    const res = await service.setStatus('admin', 'u2', false);
    expect(res.isActive).toBe(false);
    expect(sessions.revokeAll).toHaveBeenCalledWith('u2', undefined, prisma);
  });

  it('reactivation does not touch sessions', async () => {
    await service.setStatus('admin', 'u2', true);
    expect(sessions.revokeAll).not.toHaveBeenCalled();
  });
});
