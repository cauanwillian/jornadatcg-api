import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { SearchCardsDto } from '../dto/search-cards.dto.js';

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

function isImportCard(value: unknown): value is PokemonImportCard {
  if (!isCard(value)) return false;
  const set = value.set as Record<string, unknown>;
  if (!isOptionalText(set.series) || !isOptionalText(set.code)) return false;
  if (
    set.total != null &&
    (typeof set.total !== 'number' ||
      !Number.isInteger(set.total) ||
      set.total < 0 ||
      set.total > 2_147_483_647)
  )
    return false;
  if ((set.printedTotal as number) > 2_147_483_647) return false;
  if (set.releaseDate != null) {
    if (
      typeof set.releaseDate !== 'string' ||
      !/^\d{4}\/\d{2}\/\d{2}$/.test(set.releaseDate)
    )
      return false;
    const iso = set.releaseDate.replaceAll('/', '-');
    const date = new Date(`${iso}T00:00:00.000Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== iso
    )
      return false;
  }
  return (
    set.images == null ||
    (isRecord(set.images) &&
      isOptionalText(set.images.logo) &&
      isOptionalText(set.images.symbol))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || value === null || isText(value);
}

function isCard(value: unknown): value is PokemonCard {
  if (!isRecord(value) || !isRecord(value.set)) return false;
  return (
    isText(value.id) &&
    isText(value.name) &&
    isText(value.number) &&
    isText(value.set.id) &&
    isText(value.set.name) &&
    typeof value.set.printedTotal === 'number' &&
    Number.isSafeInteger(value.set.printedTotal) &&
    value.set.printedTotal > 0 &&
    isOptionalText(value.rarity) &&
    isOptionalText(value.artist) &&
    (value.images == null ||
      (isRecord(value.images) &&
        isOptionalText(value.images.small) &&
        isOptionalText(value.images.large)))
  );
}

// Adapt the provider contract once; controllers and persistence use our own shape.
function normalizeCard(value: unknown): PokemonImportCard {
  if (!isRecord(value) || !isRecord(value.expansion)) {
    throw new BadGatewayException('Resposta inválida da API Scrydex.');
  }
  let front: Record<string, unknown> | undefined;
  if (value.images != null) {
    if (
      !Array.isArray(value.images) ||
      !value.images.every(
        (entry) =>
          isRecord(entry) &&
          isText(entry.type) &&
          isOptionalText(entry.small) &&
          isOptionalText(entry.large),
      )
    ) {
      throw new BadGatewayException('Resposta inválida da API Scrydex.');
    }
    front = value.images.find(
      (entry: Record<string, unknown>) => entry.type === 'front',
    );
  }
  const expansion = value.expansion;
  const normalized = {
    id: value.id,
    name: value.name,
    number: value.number,
    rarity: value.rarity,
    artist: value.artist,
    images: { small: front?.small ?? null, large: front?.large ?? null },
    set: {
      id: expansion.id,
      name: expansion.name,
      printedTotal: expansion.printed_total,
      total: expansion.total,
      series: expansion.series,
      code: expansion.code,
      releaseDate: expansion.release_date,
      images: {
        logo: expansion.logo ?? null,
        symbol: expansion.symbol ?? null,
      },
    },
  };
  if (!isImportCard(normalized))
    throw new BadGatewayException('Resposta inválida da API Scrydex.');
  return normalized;
}

@Injectable()
export class ScrydexService {
  // One deadline covers all pages and reading their response bodies.
  private readonly timeoutMs = 10_000;

  async getById(externalId: string): Promise<PokemonImportCard> {
    const url = new URL(
      `https://api.scrydex.com/pokemon/v1/cards/${encodeURIComponent(externalId)}`,
    );
    url.searchParams.set(
      'select',
      'id,name,number,expansion,rarity,artist,images',
    );
    url.searchParams.set('casing', 'snake');
    const payload = await this.request(
      url,
      AbortSignal.timeout(this.timeoutMs),
      true,
    );
    if (
      !isRecord(payload) ||
      (payload.status !== undefined && payload.status !== 'success') ||
      !isRecord(payload.data) ||
      payload.data.id !== externalId
    ) {
      throw new BadGatewayException('Resposta inválida da API Scrydex.');
    }
    return normalizeCard(payload.data);
  }

  async search(query: SearchCardsDto): Promise<PokemonCard[]> {
    const filters: string[] = [];
    if (query.name) {
      const escaped = query.name.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&');
      filters.push(`name:"${escaped}"`);
    }
    // Fetch matching sets' cards, then compare numbers numerically in CardsService.
    // This handles any zero padding without depending on the provider's number indexing.
    if (query.code)
      filters.push(`expansion.printed_total:${query.code.printedTotal}`);

    const signal = AbortSignal.timeout(this.timeoutMs);
    const cards: PokemonCard[] = [];
    for (let page = 1; ; page++) {
      const url = new URL('https://api.scrydex.com/pokemon/v1/cards');
      url.searchParams.set('q', filters.join(' '));
      url.searchParams.set('page', String(page));
      url.searchParams.set('pageSize', '100');
      url.searchParams.set('orderBy', 'id');
      url.searchParams.set(
        'select',
        'id,name,number,expansion,rarity,artist,images',
      );
      url.searchParams.set('casing', 'snake');

      const payload = await this.request(url, signal);

      if (
        !isRecord(payload) ||
        !Array.isArray(payload.data) ||
        (payload.status !== undefined && payload.status !== 'success') ||
        payload.page !== page ||
        (payload.page_size ?? payload.pageSize) !== 100 ||
        typeof (payload.total_count ?? payload.totalCount) !== 'number' ||
        !Number.isSafeInteger(payload.total_count ?? payload.totalCount) ||
        Number(payload.total_count ?? payload.totalCount) < 0 ||
        payload.data.length > 100 ||
        cards.length + payload.data.length >
          Number(payload.total_count ?? payload.totalCount) ||
        (payload.data.length === 0 &&
          cards.length < Number(payload.total_count ?? payload.totalCount))
      ) {
        throw new BadGatewayException('Resposta inválida da API Scrydex.');
      }
      cards.push(...payload.data.map(normalizeCard));
      if (cards.length >= Number(payload.total_count ?? payload.totalCount))
        return cards;
    }
  }

  private async request(
    url: URL,
    signal: AbortSignal,
    allowNotFound = false,
  ): Promise<unknown> {
    const apiKey = process.env.SCRYDEX_API_KEY?.trim();
    const teamId = process.env.SCRYDEX_TEAM_ID?.trim();
    if (!apiKey || !teamId)
      throw new ServiceUnavailableException(
        'Integração Scrydex não configurada.',
      );
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Api-Key': apiKey,
      'X-Team-ID': teamId,
    };
    try {
      const response = await fetch(url, { headers, signal, redirect: 'error' });
      if (!response.ok) {
        await response.body?.cancel();
        if (allowNotFound && response.status === 404)
          throw new NotFoundException('Carta não encontrada na API Scrydex.');
        throw new ServiceUnavailableException(
          'API Scrydex indisponível. Tente novamente mais tarde.',
        );
      }
      return await response.json();
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error &&
          ['TimeoutError', 'AbortError'].includes(error.name))
      ) {
        throw new GatewayTimeoutException(
          'Tempo limite excedido ao consultar a API Scrydex.',
        );
      }
      if (error instanceof NotFoundException) throw error;
      if (error instanceof SyntaxError)
        throw new BadGatewayException('Resposta inválida da API Scrydex.');
      throw new ServiceUnavailableException(
        'API Scrydex indisponível. Tente novamente mais tarde.',
      );
    }
  }
}
