import { Controller, Get, Header } from '@nestjs/common';

@Controller('health')
export class HealthController {
  // Liveness only: database and external providers have independent availability.
  @Get()
  @Header('Cache-Control', 'no-store')
  getHealth() {
    return { status: 'ok' };
  }
}
