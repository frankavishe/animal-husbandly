import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTzPhone } from '../common/utils/phone';
import { UserResponseDto } from './dto/user-response.dto';

export interface CreateUserInput {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  passwordHash: string;
  role?: Role;
}

export interface ProfileUpdate {
  fullName?: string;
  phone?: string | null;
  email?: string | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  static toPublic(user: User): UserResponseDto {
    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
  }

  toPublic(user: User): UserResponseDto {
    return UsersService.toPublic(user);
  }

  async create(input: CreateUserInput): Promise<User> {
    const phone = input.phone ?? null;
    const email = input.email ?? null;
    if (!phone && !email) {
      throw new BadRequestException('Provide at least one of phone or email');
    }
    await this.assertIdentifiersFree(phone, email);
    return this.prisma.user.create({
      data: {
        fullName: input.fullName,
        phone,
        email,
        passwordHash: input.passwordHash,
        role: input.role ?? Role.CUSTOMER,
      },
    });
  }

  /** Looks a user up by email (contains `@`) or Tanzanian phone number in any accepted format. */
  async findByIdentifier(identifier: string): Promise<User | null> {
    const value = identifier.trim();
    if (value.includes('@')) {
      return this.prisma.user.findUnique({ where: { email: value.toLowerCase() } });
    }
    const phone = normalizeTzPhone(value);
    return phone ? this.prisma.user.findUnique({ where: { phone } }) : null;
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async getById(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** FR-020: update name/phone/email; `null` clears an identifier but never the last one. */
  async updateProfile(id: string, update: ProfileUpdate): Promise<User> {
    const user = await this.getById(id);
    const phone = update.phone === undefined ? user.phone : update.phone;
    const email = update.email === undefined ? user.email : update.email;
    if (!phone && !email) {
      throw new BadRequestException('At least one of phone or email must remain on the account');
    }
    await this.assertIdentifiersFree(
      phone !== user.phone ? phone : null,
      email !== user.email ? email : null,
      id,
    );
    const data: Prisma.UserUpdateInput = {};
    if (update.fullName !== undefined) data.fullName = update.fullName;
    if (update.phone !== undefined) data.phone = update.phone;
    if (update.email !== undefined) data.email = update.email;
    return this.prisma.user.update({ where: { id }, data });
  }

  updatePasswordHash(id: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  private async assertIdentifiersFree(
    phone: string | null,
    email: string | null,
    exceptUserId?: string,
  ): Promise<void> {
    if (phone) {
      const taken = await this.prisma.user.findUnique({ where: { phone }, select: { id: true } });
      if (taken && taken.id !== exceptUserId) {
        throw new ConflictException('Phone number is already registered');
      }
    }
    if (email) {
      const taken = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (taken && taken.id !== exceptUserId) {
        throw new ConflictException('Email is already registered');
      }
    }
  }
}
