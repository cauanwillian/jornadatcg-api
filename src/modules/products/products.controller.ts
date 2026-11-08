import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { ProductsService } from './products.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  CreateProductPipe,
  UpdateProductPipe,
  InventoryPipe,
  ListProductsPipe,
  ReferencePipe,
} from './dto/products.dto.js';
import type {
  CreateProductDto,
  UpdateProductDto,
  InventoryDto,
  ListProductsDto,
  ReferenceDto,
} from './dto/products.dto.js';

@Controller('products')
@UseGuards(JwtAuthGuard, AdminGuard)
export class ProductsController {
  constructor(
    @Inject(ProductsService) private readonly products: ProductsService,
  ) {}

  @Get('options')
  options() {
    return this.products.options();
  }

  @Post('categories')
  category(@Body(new ReferencePipe('category')) body: ReferenceDto) {
    return this.products.createReference('category', body);
  }

  @Post('conditions')
  condition(@Body(new ReferencePipe('condition')) body: ReferenceDto) {
    return this.products.createReference('condition', body);
  }

  @Post('languages')
  language(@Body(new ReferencePipe('language')) body: ReferenceDto) {
    return this.products.createReference('language', body);
  }

  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body(CreateProductPipe) body: CreateProductDto,
  ) {
    return this.products.create(body, req.user.id);
  }

  @Get()
  list(@Query(ListProductsPipe) query: ListProductsDto) {
    return this.products.list(query);
  }

  @Get(':id')
  find(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.products.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(UpdateProductPipe) body: UpdateProductDto,
  ) {
    return this.products.update(id, body);
  }

  @Patch(':id/inventory')
  inventory(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(InventoryPipe) body: InventoryDto,
  ) {
    return this.products.updateInventory(id, body, req.user.id);
  }
}
