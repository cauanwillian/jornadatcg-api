import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import {
  StockEntryPipe,
  stockEntryOperationKey,
} from './dto/stock-entry.dto.js';
import type { StockEntryDto } from './dto/stock-entry.dto.js';
import { StockEntriesService } from './stock-entries.service.js';

@Controller('products/:id/inventory/entries')
@UseGuards(JwtAuthGuard, AdminGuard)
export class StockEntriesController {
  constructor(
    @Inject(StockEntriesService) private readonly entries: StockEntriesService,
  ) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(StockEntryPipe) body: StockEntryDto,
  ) {
    return this.entries.create(
      id.toLowerCase(),
      request.user.id,
      stockEntryOperationKey(request),
      body,
    );
  }

  @Get(':operationKey')
  @Header('Cache-Control', 'no-store')
  find(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('operationKey', new ParseUUIDPipe()) operationKey: string,
  ) {
    return this.entries.find(
      id.toLowerCase(),
      request.user.id,
      operationKey.toLowerCase(),
    );
  }
}
