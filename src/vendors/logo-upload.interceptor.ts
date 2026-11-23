import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Observable } from 'rxjs';

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const MulterLogoInterceptor = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
});

/**
 * Reads the multipart `file` field into memory (max 2 MB) and replaces multer's generic
 * "File too large" with a clear message (FR-020). Content is verified later by magic bytes.
 */
@Injectable()
export class LogoUploadInterceptor implements NestInterceptor {
  private readonly inner = new MulterLogoInterceptor();

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    try {
      return await this.inner.intercept(ctx, next);
    } catch (e) {
      if (e instanceof PayloadTooLargeException) {
        throw new PayloadTooLargeException('Logo must be at most 2 MB');
      }
      throw e;
    }
  }
}
