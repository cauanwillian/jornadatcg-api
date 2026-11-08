import { Module } from '@nestjs/common';
import { CardsController } from './cards.controller.js';
import { CardsService } from './cards.service.js';
import { SearchCardsQueryPipe } from './dto/search-cards.dto.js';
import { TcggoService } from './integrations/tcggo.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { CardsCatalogService } from './cards-catalog.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { ImportCardBodyPipe } from './dto/import-card.dto.js';
import { ListCardsQueryPipe } from './dto/list-cards.dto.js';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [CardsController],
  providers: [
    CardsService,
    TcggoService,
    SearchCardsQueryPipe,
    CardsCatalogService,
    ImportCardBodyPipe,
    ListCardsQueryPipe,
  ],
})
export class CardsModule {}
