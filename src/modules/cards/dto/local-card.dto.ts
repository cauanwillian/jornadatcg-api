import type { Prisma } from '../../../generated/prisma/client.js';
import type { CardSearchResultDto } from './card-search-result.dto.js';

export const localCardSelect = {
  id: true,
  externalId: true,
  name: true,
  number: true,
  rarity: true,
  artist: true,
  imageSmall: true,
  imageLarge: true,
  createdAt: true,
  updatedAt: true,
  set: {
    select: {
      id: true,
      externalId: true,
      name: true,
      series: true,
      code: true,
      printedTotal: true,
      total: true,
      releaseDate: true,
      logoUrl: true,
      symbolUrl: true,
    },
  },
} satisfies Prisma.CardSelect;

export type LocalCardRecord = Prisma.CardGetPayload<{
  select: typeof localCardSelect;
}>;

export interface LocalCardDto extends Omit<CardSearchResultDto, 'set'> {
  id: string;
  set: Omit<LocalCardRecord['set'], 'releaseDate'> & {
    releaseDate: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CardsPageDto {
  data: LocalCardDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function toLocalCardDto(card: LocalCardRecord): LocalCardDto {
  return {
    id: card.id,
    externalId: card.externalId,
    name: card.name,
    number: card.number,
    rarity: card.rarity,
    artist: card.artist,
    images: { small: card.imageSmall, large: card.imageLarge },
    set: {
      ...card.set,
      releaseDate: card.set.releaseDate?.toISOString().slice(0, 10) ?? null,
    },
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}
