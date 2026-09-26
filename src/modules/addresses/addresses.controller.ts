import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { AddressesService } from './addresses.service.js';
import { AddressBodyPipe } from './dto/address.dto.js';
import type { AddressInput } from './dto/address.dto.js';

@Controller('addresses')
@UseGuards(JwtAuthGuard)
export class AddressesController {
  constructor(
    @Inject(AddressesService) private readonly addresses: AddressesService,
  ) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Req() req: AuthenticatedRequest) {
    return this.addresses.list(req.user.id);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.addresses.get(req.user.id, id);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @Req() req: AuthenticatedRequest,
    @Body(AddressBodyPipe) body: AddressInput,
  ) {
    return this.addresses.create(req.user.id, body);
  }
  @Put(':id')
  @Header('Cache-Control', 'no-store')
  replace(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(AddressBodyPipe) body: AddressInput,
  ) {
    return this.addresses.replace(req.user.id, id, body);
  }
  @Delete(':id')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.addresses.remove(req.user.id, id);
  }
}
