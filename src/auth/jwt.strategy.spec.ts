import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const payload = { sub: 'user-1', role: 'CUSTOMER', sid: 'session-1' };
  const users: any = { findById: jest.fn() };
  const sessions: any = { isLive: jest.fn() };
  const config: any = { get: () => 'x'.repeat(32) };
  const strategy = new JwtStrategy(config, users, sessions);

  beforeEach(() => {
    users.findById.mockResolvedValue({ id: 'user-1', role: 'VENDOR', isActive: true });
    sessions.isLive.mockResolvedValue(true);
  });

  it('returns the principal with the role from the database', async () => {
    await expect(strategy.validate(payload)).resolves.toEqual({
      id: 'user-1',
      role: 'VENDOR',
      sessionId: 'session-1',
    });
    expect(sessions.isLive).toHaveBeenCalledWith('session-1', 'user-1');
  });

  it('rejects an unknown user', async () => {
    users.findById.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a deactivated user with 403 even though the session is revoked', async () => {
    users.findById.mockResolvedValue({ id: 'user-1', role: 'VENDOR', isActive: false });
    sessions.isLive.mockResolvedValue(false);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a revoked session', async () => {
    sessions.isLive.mockResolvedValue(false);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
