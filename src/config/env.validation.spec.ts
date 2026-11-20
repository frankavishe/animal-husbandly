import { envValidationOptions, envValidationSchema } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('envValidationSchema', () => {
  it('accepts a minimal valid config and applies defaults', () => {
    const { error, value } = envValidationSchema.validate(valid, envValidationOptions);
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ PORT: 3000, JWT_ACCESS_TTL: 900, REFRESH_TOKEN_TTL_DAYS: 7 });
  });

  it('rejects a missing JWT_ACCESS_SECRET and names it', () => {
    const { error } = envValidationSchema.validate(
      { DATABASE_URL: valid.DATABASE_URL },
      envValidationOptions,
    );
    expect(error?.message).toContain('JWT_ACCESS_SECRET');
  });

  it('reports every missing key at once', () => {
    const { error } = envValidationSchema.validate({}, envValidationOptions);
    expect(error?.message).toContain('DATABASE_URL');
    expect(error?.message).toContain('JWT_ACCESS_SECRET');
  });

  it('rejects a too-short secret', () => {
    const { error } = envValidationSchema.validate(
      { ...valid, JWT_ACCESS_SECRET: 'short' },
      envValidationOptions,
    );
    expect(error?.message).toContain('JWT_ACCESS_SECRET');
  });
});
