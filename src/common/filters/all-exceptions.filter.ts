import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

const STATUS_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

function statusName(status: number): string {
  if (STATUS_NAMES[status]) return STATUS_NAMES[status];
  const key = HttpStatus[status] as string | undefined;
  return key
    ? key
        .toLowerCase()
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    : 'Error';
}

/** Maps every thrown error to `{ statusCode, error, message, path, timestamp }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { statusCode, message, details } = this.resolve(exception);
    if (statusCode >= 500 && statusCode !== 503) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const body: ErrorBody & { details?: unknown } = {
      statusCode,
      error: statusName(statusCode),
      message,
      path: req.originalUrl ?? req.url,
      timestamp: new Date().toISOString(),
      ...(details !== undefined ? { details } : {}),
    };
    res.status(statusCode).json(body);
  }

  private resolve(exception: unknown): {
    statusCode: number;
    message: string | string[];
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const response = exception.getResponse();
      if (typeof response === 'string') return { statusCode, message: response };
      const r = response as { message?: unknown; info?: unknown; error?: unknown };
      // Terminus health-check failure payload: { status, info, error, details }
      if (statusCode === 503 && r.info !== undefined) {
        return { statusCode, message: 'Service unavailable', details: response };
      }
      if (Array.isArray(r.message)) return { statusCode, message: r.message.map(String) };
      if (typeof r.message === 'string') return { statusCode, message: r.message };
      return { statusCode, message: exception.message };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const target = (exception.meta?.target as string[] | string | undefined) ?? 'value';
        const fields = Array.isArray(target) ? target.join(', ') : target;
        return { statusCode: 409, message: `A record with this ${fields} already exists` };
      }
      if (exception.code === 'P2025') {
        return { statusCode: 404, message: 'Resource not found' };
      }
    }
    return { statusCode: 500, message: 'Internal server error' };
  }
}
