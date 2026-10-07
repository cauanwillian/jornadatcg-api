import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BannersService } from './banners.service.js';
import {
  BannersController,
  AdminBannersController,
} from './banners.controller.js';
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [BannersController, AdminBannersController],
  providers: [BannersService],
})
export class BannersModule {}
