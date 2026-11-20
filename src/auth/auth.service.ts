import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthUser } from '../common/decorators';
import { AppConfig } from '../config/env.validation';
import { UsersService } from '../users/users.service';
import { AuthResponseDto, ChangePasswordDto, LoginDto, RegisterDto } from './dto';
import { ClientInfo, IssuedSession, SessionsService } from './sessions.service';

export interface JwtPayload {
  sub: string;
  role: string;
  sid: string;
}

const INVALID_CREDENTIALS = 'Invalid credentials';
export const ACCOUNT_DEACTIVATED = 'Account deactivated';

@Injectable()
export class AuthService {
  /** Hash compared against when the user does not exist, so timing doesn't reveal accounts. */
  private readonly dummyHash: string;

  constructor(
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    this.dummyHash = bcrypt.hashSync('dummy-password-0', this.rounds);
  }

  private get rounds(): number {
    return this.config.get('BCRYPT_ROUNDS', { infer: true });
  }

  async register(dto: RegisterDto, client: ClientInfo): Promise<AuthResponseDto> {
    const user = await this.users.create({
      fullName: dto.fullName,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      passwordHash: await bcrypt.hash(dto.password, this.rounds),
    });
    return this.buildResponse(user, await this.sessions.create(user.id, client));
  }

  async login(dto: LoginDto, client: ClientInfo): Promise<AuthResponseDto> {
    const user = await this.users.findByIdentifier(dto.identifier);
    const ok = await bcrypt.compare(dto.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !ok) throw new UnauthorizedException(INVALID_CREDENTIALS);
    if (!user.isActive) throw new ForbiddenException(ACCOUNT_DEACTIVATED);
    return this.buildResponse(user, await this.sessions.create(user.id, client));
  }

  async refresh(refreshToken: string, client: ClientInfo): Promise<AuthResponseDto> {
    const issued = await this.sessions.rotate(refreshToken, client);
    const user = await this.users.findById(issued.session.userId);
    if (!user || !user.isActive) {
      if (user) await this.sessions.revokeAll(user.id);
      throw new ForbiddenException(ACCOUNT_DEACTIVATED);
    }
    return this.buildResponse(user, issued);
  }

  logout(refreshToken: string): Promise<void> {
    return this.sessions.revoke(refreshToken);
  }

  /** FR-016: verifies the current password, stores the new one and signs out all other sessions. */
  async changePassword(principal: AuthUser, dto: ChangePasswordDto): Promise<void> {
    const user = await this.users.getById(principal.id);
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must differ from the current password');
    }
    await this.users.updatePasswordHash(user.id, await bcrypt.hash(dto.newPassword, this.rounds));
    await this.sessions.revokeAll(user.id, principal.sessionId);
  }

  private async buildResponse(user: User, issued: IssuedSession): Promise<AuthResponseDto> {
    const payload: JwtPayload = { sub: user.id, role: user.role, sid: issued.session.id };
    return {
      accessToken: await this.jwt.signAsync(payload),
      refreshToken: issued.refreshToken,
      expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      user: UsersService.toPublic(user),
    };
  }
}
