import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
  Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Observable } from 'rxjs';

/**
 * Builds an interceptor that reads the multipart `file` field into memory (max `maxBytes`) and
 * replaces multer's generic "File too large" with `<label> must be at most <N> MB`.
 * Content is verified later by magic bytes (`detectImageType`).
 */
export function createImageUploadInterceptor(
  maxBytes: number,
  label: string,
): Type<NestInterceptor> {
  const MulterInterceptor = FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
  });
  const message = `${label} must be at most ${maxBytes / (1024 * 1024)} MB`;

  @Injectable()
  class ImageUploadInterceptor implements NestInterceptor {
    private readonly inner = new MulterInterceptor();

    async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      try {
        return await this.inner.intercept(ctx, next);
      } catch (e) {
        if (e instanceof PayloadTooLargeException) throw new PayloadTooLargeException(message);
        throw e;
      }
    }
  }

  return ImageUploadInterceptor;
}
