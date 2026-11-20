import { BadRequestException, ConflictException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';

const existing = {
  id: 'u1',
  fullName: 'Juma',
  phone: '+255712345678',
  email: null as string | null,
  passwordHash: 'hash',
  role: Role.CUSTOMER,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UsersService', () => {
  let prisma: any;
  let service: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(({ data }) => Promise.resolve({ ...existing, ...data })),
        update: jest.fn(({ data }) => Promise.resolve({ ...existing, ...data })),
      },
    };
    service = new UsersService(prisma);
  });

  it('toPublic never exposes the password hash', () => {
    expect(UsersService.toPublic(existing)).not.toHaveProperty('passwordHash');
  });

  it('create requires phone or email and defaults to CUSTOMER', async () => {
    await expect(service.create({ fullName: 'X', passwordHash: 'h' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    prisma.user.findUnique.mockResolvedValue(null);
    await service.create({ fullName: 'X', email: 'x@y.tz', passwordHash: 'h' });
    expect(prisma.user.create.mock.calls[0][0].data.role).toBe(Role.CUSTOMER);
  });

  it('create rejects a taken phone', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'other' });
    await expect(
      service.create({ fullName: 'X', phone: '+255712345678', passwordHash: 'h' }),
    ).rejects.toThrow(new ConflictException('Phone number is already registered'));
  });

  it('findByIdentifier routes emails (lowercased) and normalised phones', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await service.findByIdentifier(' Juma@Mail.COM ');
    expect(prisma.user.findUnique).toHaveBeenLastCalledWith({ where: { email: 'juma@mail.com' } });
    await service.findByIdentifier('0712 345 678');
    expect(prisma.user.findUnique).toHaveBeenLastCalledWith({ where: { phone: '+255712345678' } });
    prisma.user.findUnique.mockClear();
    expect(await service.findByIdentifier('garbage')).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  describe('updateProfile', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(where.id === 'u1' ? existing : null),
      );
    });

    it('refuses to remove the last identifier', async () => {
      await expect(service.updateProfile('u1', { phone: null })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('allows clearing phone when an email is added at the same time', async () => {
      const res = await service.updateProfile('u1', { phone: null, email: 'new@mail.tz' });
      expect(res).toMatchObject({ phone: null, email: 'new@mail.tz' });
    });

    it('rejects an email used by another account', async () => {
      prisma.user.findUnique.mockImplementation(({ where }: any) =>
        Promise.resolve(where.id === 'u1' ? existing : { id: 'u2' }),
      );
      await expect(service.updateProfile('u1', { email: 'taken@mail.tz' })).rejects.toThrow(
        new ConflictException('Email is already registered'),
      );
    });
  });
});
