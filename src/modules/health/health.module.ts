import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { DatabaseModule } from '../../database/database.module.js';
import { ReadinessService } from './readiness.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class HealthModule {}
