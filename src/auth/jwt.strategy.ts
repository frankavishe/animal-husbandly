import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser } from '../common/decorators';
import { AppConfig } from '../config/env.validation';
import { UsersService } from '../users/users.service';
import { ACCOUNT_DEACTIVATED, JwtPayload } from './auth.service';

/**
 * Validates the Bearer access token, then loads the user so that deactivation takes effect on the
 * very next request (SC-003) and authorization uses the role from the database, not the token.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedException();
    if (!user.isActive) throw new ForbiddenException(ACCOUNT_DEACTIVATED);
    return { id: user.id, role: user.role, sessionId: payload.sid };
  }
}
