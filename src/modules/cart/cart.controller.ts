import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { CartService } from './cart.service.js';
import { SetCartItemPipe } from './dto/cart-item.dto.js';
import type { SetCartItemDto } from './dto/cart-item.dto.js';

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(@Inject(CartService) private readonly cart: CartService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@Req() request: AuthenticatedRequest) {
    return this.cart.get(request.user.id);
  }

  @Put('items/:productId')
  @Header('Cache-Control', 'no-store')
  set(
    @Req() request: AuthenticatedRequest,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body(SetCartItemPipe) body: SetCartItemDto,
  ) {
    return this.cart.setItem(request.user.id, productId, body.quantity);
  }

  @Delete('items/:productId')
  @Header('Cache-Control', 'no-store')
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.cart.removeItem(request.user.id, productId);
  }

  @Delete()
  @Header('Cache-Control', 'no-store')
  clear(@Req() request: AuthenticatedRequest) {
    return this.cart.clear(request.user.id);
  }
}
