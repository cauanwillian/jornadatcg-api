import {
  Body,
  Controller,
  Get,
  Header,
  createParamDecorator,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { OrdersService } from './orders.service.js';
import { CheckoutPipe, OrderListPipe } from './dto/order-input.dto.js';
import type { CheckoutDto, OrderListQuery } from './dto/order-input.dto.js';

const IdempotencyKey = createParamDecorator(
  (_data, context) =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().headers[
      'idempotency-key'
    ],
);

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  checkout(
    @Req() request: AuthenticatedRequest,
    @IdempotencyKey(new ParseUUIDPipe({ version: '4' }))
    checkoutKey: string,
    @Body(CheckoutPipe) body: CheckoutDto,
  ) {
    return this.orders.checkout(
      request.user.id,
      checkoutKey.toLowerCase(),
      body,
    );
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: AuthenticatedRequest,
    @Query(OrderListPipe) query: OrderListQuery,
  ) {
    return this.orders.list(request.user.id, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.get(request.user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.orders.cancel(request.user.id, id);
  }
}
