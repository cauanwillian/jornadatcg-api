import { Inject, Injectable } from '@nestjs/common';
import { ScrydexService } from './integrations/scrydex.service.js';
import type { SearchCardsDto } from './dto/search-cards.dto.js';
import type { CardSearchResultDto } from './dto/card-search-result.dto.js';

@Injectable()
export class CardsService {
  constructor(
    @Inject(ScrydexService) private readonly scrydex: ScrydexService,
  ) {}

  async search(query: SearchCardsDto): Promise<CardSearchResultDto[]> {
    const cards = await this.scrydex.search(query);
    return cards
      .filter(
        (card) =>
          !query.code ||
          (/^\d+$/.test(card.number) &&
            Number(card.number) === query.code.number &&
            card.set.printedTotal === query.code.printedTotal),
      )
      .map((card) => ({
        externalId: card.id,
        name: card.name,
        number: card.number,
        set: {
          externalId: card.set.id,
          name: card.set.name,
          printedTotal: card.set.printedTotal,
        },
        rarity: card.rarity ?? null,
        artist: card.artist ?? null,
        images: {
          small: card.images?.small ?? null,
          large: card.images?.large ?? null,
        },
      }));
  }
}
