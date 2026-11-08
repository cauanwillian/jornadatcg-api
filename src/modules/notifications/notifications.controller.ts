import {
  Controller,
  Get,
  Header,
  Inject,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsQueryPipe } from './dto/notifications-query.dto.js';
import type { NotificationsQuery } from './dto/notifications-query.dto.js';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: AuthenticatedRequest,
    @Query(NotificationsQueryPipe) query: NotificationsQuery,
  ) {
    return this.notifications.list(request.user.id, query);
  }
}
