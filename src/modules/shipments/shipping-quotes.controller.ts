import {
  Controller,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ShippingQuotesService } from './shipping-quotes.service.js';

@Controller('shipments/:id/quotes')
@UseGuards(JwtAuthGuard)
export class ShippingQuotesController {
  constructor(
    @Inject(ShippingQuotesService)
    private readonly quotes: ShippingQuotesService,
  ) {}
  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  quote(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.quotes.quote(req.user.id, id);
  }
  @Post(':quoteId/select')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  select(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('quoteId', new ParseUUIDPipe()) quoteId: string,
  ) {
    return this.quotes.select(req.user.id, id, quoteId);
  }
}
