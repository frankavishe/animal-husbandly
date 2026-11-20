import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Session } from '@prisma/client';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

export interface ClientInfo {
  userAgent?: string | null;
  ip?: string | null;
}

export interface IssuedSession {
  session: Session;
  refreshToken: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = 'Invalid or expired refresh token';

/**
 * Refresh-token sessions. Token format: `<sessionId>.<secret>` where the secret is 256 random bits
 * (base64url). Only SHA-256(secret) is stored. Each token is single-use; presenting a spent or
 * revoked token revokes every session of that user (replay detection, FR-014).
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  static hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  static parse(token: string): { id: string; secret: string } | null {
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const id = token.slice(0, dot);
    const secret = token.slice(dot + 1);
    if (!UUID_RE.test(id) || secret.length < 20) return null;
    return { id, secret };
  }

  async create(
    userId: string,
    client: ClientInfo = {},
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<IssuedSession> {
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const ttlDays = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    const session = await tx.session.create({
      data: {
        id,
        userId,
        tokenHash: SessionsService.hash(secret),
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
        userAgent: client.userAgent?.slice(0, 500) ?? null,
        ip: client.ip ?? null,
      },
    });
    return { session, refreshToken: `${id}.${secret}` };
  }

  /** Looks up the session for a token, verifying the secret. Returns null if unknown/mismatched. */
  async find(token: string): Promise<Session | null> {
    const parsed = SessionsService.parse(token);
    if (!parsed) return null;
    const session = await this.prisma.session.findUnique({ where: { id: parsed.id } });
    if (!session) return null;
    const expected = Buffer.from(session.tokenHash, 'hex');
    const actual = Buffer.from(SessionsService.hash(parsed.secret), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return session;
  }

  /**
   * Spends `token` and issues a replacement session atomically.
   * Throws 401 for unknown, expired, used or revoked tokens; used/revoked also revoke all sessions.
   */
  async rotate(token: string, client: ClientInfo = {}): Promise<IssuedSession> {
    const session = await this.find(token);
    if (!session) throw new UnauthorizedException(INVALID);

    if (session.usedAt || session.revokedAt) {
      await this.revokeAll(session.userId);
      throw new UnauthorizedException(INVALID);
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException(INVALID);
    }

    const issued = await this.prisma.$transaction(async (tx) => {
      // Conditional update guards against two concurrent refreshes of the same token.
      const spent = await tx.session.updateMany({
        where: { id: session.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (spent.count !== 1) return null;
      return this.create(session.userId, client, tx);
    });

    if (!issued) {
      await this.revokeAll(session.userId);
      throw new UnauthorizedException(INVALID);
    }
    return issued;
  }

  /** Revokes the session behind `token` if it is valid. Silent otherwise (logout is idempotent). */
  async revoke(token: string): Promise<void> {
    const session = await this.find(token);
    if (!session || session.revokedAt) return;
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every live session of a user, optionally keeping one (e.g. the current one). */
  async revokeAll(
    userId: string,
    exceptSessionId?: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const result = await tx.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}
