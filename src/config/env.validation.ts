import * as Joi from 'joi';

/** Startup configuration schema. All problems are reported at once (abortEarly: false). */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.number().integer().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).default(7),
  BCRYPT_ROUNDS: Joi.number().integer().min(4).max(15).default(10),
  AUTH_THROTTLE_LIMIT: Joi.number().integer().min(1).default(10),
  AUTH_THROTTLE_TTL_MS: Joi.number().integer().min(1000).default(60000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  S3_ENDPOINT: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  S3_REGION: Joi.string().required(),
  S3_BUCKET: Joi.string().required(),
  S3_ACCESS_KEY_ID: Joi.string().required(),
  S3_SECRET_ACCESS_KEY: Joi.string().required(),
  S3_PUBLIC_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
  ORDER_EXPIRY_INTERVAL_MS: Joi.number().integer().min(0).max(600000).default(300000),
});

export const envValidationOptions = { abortEarly: false, allowUnknown: true };

export interface AppConfig {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL: number;
  REFRESH_TOKEN_TTL_DAYS: number;
  BCRYPT_ROUNDS: number;
  AUTH_THROTTLE_LIMIT: number;
  AUTH_THROTTLE_TTL_MS: number;
  LOG_LEVEL: string;
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_PUBLIC_BASE_URL: string;
  S3_FORCE_PATH_STYLE: boolean;
  /** How often PENDING sub-orders older than 48 h are expired; 0 turns expiry off. */
  ORDER_EXPIRY_INTERVAL_MS: number;
}
