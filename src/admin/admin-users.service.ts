import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SessionsService } from '../auth/sessions.service';
import { Paginated, paginate, toSkipTake } from '../common/dto/pagination.dto';
import { normalizeTzPhone } from '../common/utils/phone';
import { PrismaService } from '../prisma/prisma.service';
import { UserResponseDto } from '../users/dto';
import { UsersService } from '../users/users.service';
import { ListUsersQueryDto } from './dto';

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
  ) {}

  async list(q: ListUsersQueryDto): Promise<Paginated<UserResponseDto>> {
    const where: Prisma.UserWhereInput = {};
    if (q.role) where.role = q.role;
    if (q.isActive !== undefined) where.isActive = q.isActive;
    if (q.search) {
      const term = q.search;
      const phone = normalizeTzPhone(term);
      const digits = term.replace(/[\s\-()]/g, '');
      where.OR = [
        { fullName: { contains: term, mode: 'insensitive' } },
        { email: { contains: term.toLowerCase() } },
        { phone: { contains: phone ?? digits } },
      ];
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(q) }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(
      rows.map((u) => UsersService.toPublic(u)),
      total,
      q,
    );
  }

  async get(id: string): Promise<UserResponseDto> {
    return UsersService.toPublic(await this.users.getById(id));
  }

  /** FR-026: activate/deactivate any account except one's own; deactivation revokes sessions. */
  async setStatus(adminId: string, id: string, isActive: boolean): Promise<UserResponseDto> {
    if (adminId === id) {
      throw new BadRequestException('You cannot change the status of your own account');
    }
    await this.users.getById(id);
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: { isActive } });
      if (!isActive) await this.sessions.revokeAll(id, undefined, tx);
      return updated;
    });
    return UsersService.toPublic(user);
  }
}
