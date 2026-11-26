import { envValidationOptions, envValidationSchema } from './env.validation';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9100',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'vendor-logos',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_PUBLIC_BASE_URL: 'http://localhost:9100/vendor-logos',
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

  it('rejects a missing S3_BUCKET and defaults S3_FORCE_PATH_STYLE to true', () => {
    const withoutBucket: Partial<typeof valid> = { ...valid };
    delete withoutBucket.S3_BUCKET;
    const { error } = envValidationSchema.validate(withoutBucket, envValidationOptions);
    expect(error?.message).toContain('S3_BUCKET');
    const { value } = envValidationSchema.validate(valid, envValidationOptions);
    expect(value).toMatchObject({ S3_FORCE_PATH_STYLE: true });
  });

  it('rejects a too-short secret', () => {
    const { error } = envValidationSchema.validate(
      { ...valid, JWT_ACCESS_SECRET: 'short' },
      envValidationOptions,
    );
    expect(error?.message).toContain('JWT_ACCESS_SECRET');
  });

  it('defaults ORDER_EXPIRY_INTERVAL_MS to 5 minutes, allows 0 and rejects out-of-range values', () => {
    expect(envValidationSchema.validate(valid, envValidationOptions).value).toMatchObject({
      ORDER_EXPIRY_INTERVAL_MS: 300000,
    });
    expect(
      envValidationSchema.validate(
        { ...valid, ORDER_EXPIRY_INTERVAL_MS: '0' },
        envValidationOptions,
      ).value,
    ).toMatchObject({ ORDER_EXPIRY_INTERVAL_MS: 0 });
    for (const bad of ['-1', '600001', '1.5', 'abc']) {
      const { error } = envValidationSchema.validate(
        { ...valid, ORDER_EXPIRY_INTERVAL_MS: bad },
        envValidationOptions,
      );
      expect(error?.message).toContain('ORDER_EXPIRY_INTERVAL_MS');
    }
  });
});
