import {
  HttpException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderActorType, SubOrderStatus } from '@prisma/client';
import { AppConfig } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { EXPIRY_REASON, RESPONSE_LIMIT_HOURS } from './order-status';
import { SubOrderTransitionsService } from './sub-order-transitions.service';

export const EXPIRY_BATCH = 100;

export interface ExpiryResult {
  expired: number;
  failed: number;
}

/**
 * Cancels sub-orders still PENDING 48 hours after placement (FR-024a, R10). Runs at startup and
 * every ORDER_EXPIRY_INTERVAL_MS (0 = never). Runs never overlap in one process; the row lock in
 * `SubOrderTransitionsService` makes several instances safe.
 */
@Injectable()
export class OrderExpiryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrderExpiryService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<ExpiryResult> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transitions: SubOrderTransitionsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onApplicationBootstrap(): void {
    const interval = this.config.get('ORDER_EXPIRY_INTERVAL_MS', { infer: true });
    if (!interval) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), interval);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running?.catch(() => undefined);
  }

  /** One pass; a call while a pass is in progress shares that pass. */
  run(now: Date = new Date()): Promise<ExpiryResult> {
    if (!this.running) {
      this.running = this.expireDue(now).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async expireDue(now: Date): Promise<ExpiryResult> {
    const cutoff = new Date(now.getTime() - RESPONSE_LIMIT_HOURS * 3_600_000);
    const result: ExpiryResult = { expired: 0, failed: 0 };
    let cursor: string | undefined;
    try {
      for (;;) {
        const due = await this.prisma.subOrder.findMany({
          where: {
            status: SubOrderStatus.PENDING,
            createdAt: { lte: cutoff },
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: EXPIRY_BATCH,
        });
        for (const { id } of due) {
          try {
            await this.transitions.apply({
              subOrderId: id,
              actorType: OrderActorType.MARKETPLACE,
              actorId: null,
              action: 'expire',
              reason: EXPIRY_REASON,
            });
            result.expired += 1;
          } catch (err) {
            // Someone acted first (409) or it vanished (404): nothing to do.
            if (err instanceof HttpException && err.getStatus() < 500) continue;
            result.failed += 1;
            this.logger.error(`Could not expire sub-order ${id}`, err as Error);
          }
        }
        if (due.length < EXPIRY_BATCH) break;
        cursor = due[due.length - 1].id;
      }
    } catch (err) {
      this.logger.error('Order expiry run failed', err as Error);
    }
    if (result.expired || result.failed) {
      this.logger.log(`Expired ${result.expired} sub-order(s); ${result.failed} failed`);
    }
    return result;
  }
}
