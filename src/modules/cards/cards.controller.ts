import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CardsService } from './cards.service.js';
import { SearchCardsQueryPipe } from './dto/search-cards.dto.js';
import type { SearchCardsDto } from './dto/search-cards.dto.js';
import type { CardSearchResultDto } from './dto/card-search-result.dto.js';
import { CardsCatalogService } from './cards-catalog.service.js';
import { ImportCardBodyPipe } from './dto/import-card.dto.js';
import type { ImportCardDto } from './dto/import-card.dto.js';
import { ListCardsQueryPipe } from './dto/list-cards.dto.js';
import type { ListCardsDto } from './dto/list-cards.dto.js';
import type { CardsPageDto, LocalCardDto } from './dto/local-card.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';

@Controller('cards')
export class CardsController {
  constructor(
    @Inject(CardsService) private readonly cardsService: CardsService,
    @Inject(CardsCatalogService) private readonly catalog: CardsCatalogService,
  ) {}

  @Get('search')
  search(
    @Query(SearchCardsQueryPipe) query: SearchCardsDto,
  ): Promise<CardSearchResultDto[]> {
    return this.cardsService.search(query);
  }

  @Post('import')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AdminGuard)
  importCard(
    @Body(ImportCardBodyPipe) body: ImportCardDto,
  ): Promise<LocalCardDto> {
    return this.catalog.importCard(body.externalId);
  }

  @Get()
  list(@Query(ListCardsQueryPipe) query: ListCardsDto): Promise<CardsPageDto> {
    return this.catalog.list(query);
  }

  @Get(':id')
  findById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<LocalCardDto> {
    return this.catalog.findById(id);
  }
}
