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
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { BannersService } from './banners.service.js';
import { bannerInput } from './banner-input.js';
const upload = FileInterceptor('image', {
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4, fieldSize: 1024 },
});
@Controller('banners')
export class BannersController {
  constructor(
    @Inject(BannersService) private readonly service: BannersService,
  ) {}
  @Get() @Header('Cache-Control', 'no-store') list() {
    return this.service.list();
  }
  @Get(':id/image')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async image(@Param('id', new ParseUUIDPipe()) id: string) {
    return new StreamableFile(await this.service.image(id), {
      type: 'image/webp',
    });
  }
}
@Controller('admin/banners')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminBannersController {
  constructor(
    @Inject(BannersService) private readonly service: BannersService,
  ) {}
  @Get() list() {
    return this.service.list(true);
  }
  @Post() @UseInterceptors(upload) async create(
    @Body() body: unknown,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    const data = bannerInput(body);
    return this.service.create(
      { ...data, title: data.title! },
      await this.service.normalize(file),
    );
  }
  @Patch(':id') update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(id, bannerInput(body, true));
  }
  @Post(':id/image') @HttpCode(200) @UseInterceptors(upload) async replace(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    return this.service.replace(id, await this.service.normalize(file));
  }
  @Get(':id/image')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async preview(@Param('id', new ParseUUIDPipe()) id: string) {
    return new StreamableFile(await this.service.image(id, true), {
      type: 'image/webp',
    });
  }
  @Delete(':id') @HttpCode(204) remove(
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.service.remove(id);
  }
}
