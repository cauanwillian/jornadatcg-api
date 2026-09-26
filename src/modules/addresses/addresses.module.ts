import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AddressesController } from './addresses.controller.js';
import { AddressesService } from './addresses.service.js';
import { AddressBodyPipe } from './dto/address.dto.js';
@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [AddressesController],
  providers: [AddressesService, AddressBodyPipe],
})
export class AddressesModule {}
