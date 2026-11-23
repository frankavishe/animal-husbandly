import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { AUTH_THROTTLER } from './auth/auth.constants';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { HealthModule } from './common/health/health.module';
import { AppConfig, envValidationOptions, envValidationSchema } from './config/env.validation';
import { ListingsModule } from './listings/listings.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './common/storage';
import { UsersModule } from './users/users.module';
import { VendorsModule } from './vendors/vendors.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validationSchema: envValidationSchema,
      validationOptions: envValidationOptions,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.currentPassword',
              'req.body.newPassword',
              'req.body.refreshToken',
            ],
            censor: '[REDACTED]',
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => [
        {
          name: AUTH_THROTTLER,
          ttl: config.get('AUTH_THROTTLE_TTL_MS', { infer: true }),
          limit: config.get('AUTH_THROTTLE_LIMIT', { infer: true }),
        },
      ],
    }),
    PrismaModule,
    StorageModule,
    HealthModule,
    UsersModule,
    AuthModule,
    VendorsModule,
    ListingsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
