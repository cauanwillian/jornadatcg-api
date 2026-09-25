export interface CardSearchResultDto {
  externalId: string;
  name: string;
  number: string;
  set: {
    externalId: string;
    name: string;
    printedTotal: number;
  };
  rarity: string | null;
  artist: string | null;
  images: { small: string | null; large: string | null };
}
