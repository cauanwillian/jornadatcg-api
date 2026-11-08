// Internal contract shared by search and import, independent of the provider.
export interface PokemonCard {
  id: string;
  name: string;
  number: string;
  set: { id: string; name: string; printedTotal: number };
  rarity?: string | null;
  artist?: string | null;
  images?: { small?: string | null; large?: string | null } | null;
}

export interface PokemonImportCard extends PokemonCard {
  set: PokemonCard['set'] & {
    series?: string | null;
    code?: string | null;
    total?: number | null;
    releaseDate?: string | null;
    images?: { logo?: string | null; symbol?: string | null } | null;
  };
}
