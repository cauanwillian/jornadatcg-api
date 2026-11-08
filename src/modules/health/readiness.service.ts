import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class ReadinessService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async check() {
    try {
      await this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT 1`;
        },
        { maxWait: 1000, timeout: 2000 },
      );
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException(
        'API temporariamente indisponível.',
      );
    }
  }
}
