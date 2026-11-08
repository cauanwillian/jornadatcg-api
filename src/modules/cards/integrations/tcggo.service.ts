import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { SearchCardsDto } from '../dto/search-cards.dto.js';
import type { PokemonImportCard } from './pokemon-card.js';

const host = 'pokemon-tcg-api.p.rapidapi.com';
const pageSize = 20;
const maxPages = 20;
const cacheTtlMs = 5 * 60_000;
const maxCacheEntries = 100;
const maxInt = 2_147_483_647;

function invalid(): never {
  throw new BadGatewayException(
    'Resposta inválida da API Pokémon TCG (TCGGO).',
  );
}
function timedOut(): GatewayTimeoutException {
  return new GatewayTimeoutException(
    'Tempo limite excedido ao consultar a API Pokémon TCG (TCGGO).',
  );
}
// A shared cache miss may have been started by a request with a later deadline.
// Stop this caller's wait without cancelling the other caller's work.
function withinDeadline<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(timedOut());
    if (signal.aborted) {
      // Still attach handlers below so a later task rejection is consumed.
      abort();
    } else {
      signal.addEventListener('abort', abort, { once: true });
    }
    task.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) abort();
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function integer(
  value: unknown,
  minimum = 0,
  maximum = maxInt,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}
function optionalText(value: unknown): string | null {
  return value == null ? null : text(value);
}
function cardNumber(value: unknown): string {
  if (integer(value)) return String(value);
  const raw = text(value).trim();
  if (!raw.includes('/')) return raw;
  // Live TCGGO responses can include the printed code instead of only the
  // collector number. The collection total still comes from episode metadata:
  // reprints may retain a denominator belonging to the original collection.
  const code = /^([^/\s]+)\/([^/\s]+)$/.exec(raw);
  if (!code) invalid();
  return code[1];
}
function numericId(value: unknown): number {
  if (!integer(value, 1, Number.MAX_SAFE_INTEGER)) invalid();
  return value;
}
function date(value: unknown): string | null {
  if (value == null) return null;
  const iso = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) invalid();
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== iso
  )
    invalid();
  // The persistence layer already accepts this internal date representation.
  return iso.replaceAll('-', '/');
}
function normalizeSet(value: unknown): PokemonImportCard['set'] {
  if (!record(value) || !integer(value.cards_printed_total, 1)) invalid();
  if (value.cards_total != null && !integer(value.cards_total)) invalid();
  if (value.series != null && !record(value.series)) invalid();
  return {
    id: `tcggo_${numericId(value.id)}`,
    name: text(value.name),
    printedTotal: value.cards_printed_total,
    total: value.cards_total ?? null,
    series:
      value.series == null
        ? null
        : text((value.series as Record<string, unknown>).name),
    code: optionalText(value.code),
    releaseDate: date(value.released_at),
    images: {
      logo: optionalText(value.logo),
      symbol: optionalText(value.symbol),
    },
  };
}

@Injectable()
export class TcggoService {
  private readonly timeoutMs = 10_000;
  private readonly cache = new Map<string, { until: number; value: unknown }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  private blockedUntil = 0;

  async getById(externalId: string): Promise<PokemonImportCard> {
    // Namespacing avoids treating an old provider's ID as a TCGGO ID.
    const match = /^tcggo_([1-9]\d*)$/.exec(externalId);
    if (!match || !Number.isSafeInteger(Number(match[1]))) {
      throw new BadRequestException(
        'Use o externalId tcggo_ retornado pela pesquisa de cartas.',
      );
    }
    this.apiKey();
    return this.remember(`card:${externalId}`, async () => {
      const signal = AbortSignal.timeout(this.timeoutMs);
      const payload = await this.request(`/cards/${match[1]}`, signal, true);
      if (
        !record(payload) ||
        !record(payload.data) ||
        payload.data.id !== Number(match[1])
      )
        invalid();
      return this.normalizeCard(payload.data, signal);
    });
  }

  async search(query: SearchCardsDto): Promise<PokemonImportCard[]> {
    this.apiKey();
    const key = JSON.stringify([
      query.name ?? null,
      query.code?.number ?? null,
      query.code?.printedTotal ?? null,
    ]);
    return this.remember(`search:${key}`, async () => {
      const signal = AbortSignal.timeout(this.timeoutMs);
      const cards: PokemonImportCard[] = [];
      const ids = new Set<string>();
      let expectedTotal: number | undefined;
      let expectedPages: number | undefined;
      for (let page = 1; page <= maxPages; page++) {
        const url = new URL(`https://${host}/cards`);
        if (query.name) url.searchParams.set('name', query.name);
        // Partial numeric search includes both 025 and 25; number and printed
        // total are then checked locally, without comparing the whole code.
        if (query.code)
          url.searchParams.set('search', String(query.code.number));
        url.searchParams.set('page', String(page));
        url.searchParams.set('per_page', String(pageSize));
        const payload = await this.request(url, signal);
        if (
          !record(payload) ||
          !Array.isArray(payload.data) ||
          !record(payload.paging) ||
          payload.paging.current !== page ||
          !integer(payload.paging.total) ||
          !integer(payload.paging.per_page, 1, pageSize) ||
          !integer(payload.results) ||
          payload.data.length > payload.paging.per_page ||
          page > Math.max(1, payload.paging.total) ||
          (expectedTotal !== undefined && expectedTotal !== payload.results) ||
          (expectedPages !== undefined &&
            expectedPages !== payload.paging.total)
        )
          invalid();
        expectedTotal = payload.results;
        expectedPages = payload.paging.total;
        if (
          Math.max(1, Math.ceil(expectedTotal / payload.paging.per_page)) !==
            Math.max(1, expectedPages) ||
          cards.length + payload.data.length > expectedTotal ||
          (payload.data.length === 0 && expectedTotal > 0)
        )
          invalid();
        if (expectedPages > maxPages) {
          throw new ServiceUnavailableException(
            'Pesquisa muito ampla. Informe um nome mais específico ou combine name e code.',
          );
        }
        for (const item of payload.data) {
          const card = await this.normalizeCard(item, signal);
          if (ids.has(card.id)) invalid();
          ids.add(card.id);
          cards.push(card);
        }
        if (page >= expectedPages) {
          if (cards.length !== expectedTotal) invalid();
          return cards;
        }
      }
      // Every advertised page must succeed; never return partial search results.
      invalid();
    });
  }

  private async normalizeCard(
    value: unknown,
    signal: AbortSignal,
  ): Promise<PokemonImportCard> {
    if (!record(value) || !record(value.episode)) invalid();
    const id = numericId(value.id);
    const number = cardNumber(value.card_number);
    const name = text(value.name);
    const rarity = optionalText(value.rarity);
    if (value.artist != null && !record(value.artist)) invalid();
    const artist =
      value.artist == null
        ? null
        : text((value.artist as Record<string, unknown>).name);
    const image = optionalText(value.image);
    let set: PokemonImportCard['set'];
    if (value.episode.cards_printed_total === undefined) {
      const episodeId = numericId(value.episode.id);
      set = await withinDeadline(
        this.remember(`episode:${episodeId}`, async () => {
          const payload = await this.request(`/episodes/${episodeId}`, signal);
          if (
            !record(payload) ||
            !record(payload.data) ||
            payload.data.id !== episodeId
          )
            invalid();
          return normalizeSet(payload.data);
        }),
        signal,
      );
    } else {
      set = normalizeSet(value.episode);
    }
    if (signal.aborted) throw timedOut();
    return {
      id: `tcggo_${id}`,
      name,
      number,
      set,
      rarity,
      artist,
      images: { small: image, large: image },
    };
  }

  private async remember<T>(key: string, work: () => Promise<T>): Promise<T> {
    const entry = this.cache.get(key);
    if (entry && entry.until > Date.now())
      return structuredClone(entry.value) as T;
    this.cache.delete(key);
    let task = this.pending.get(key);
    if (!task) {
      if (this.pending.size >= maxCacheEntries) {
        throw new ServiceUnavailableException(
          'Pesquisa de cartas ocupada. Tente novamente em instantes.',
        );
      }
      task = work()
        .then((value) => {
          if (this.cache.size >= maxCacheEntries)
            this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, { until: Date.now() + cacheTtlMs, value });
          return value;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, task);
    }
    return structuredClone(await task) as T;
  }

  private apiKey(): string {
    const key = process.env.TCGGO_RAPIDAPI_KEY?.trim();
    if (!key)
      throw new ServiceUnavailableException(
        'Integração Pokémon TCG (TCGGO/RapidAPI) não configurada.',
      );
    return key;
  }

  private async request(
    path: string | URL,
    signal: AbortSignal,
    allowNotFound = false,
  ): Promise<unknown> {
    const key = this.apiKey();
    if (Date.now() < this.blockedUntil) throw this.quotaError();
    const url =
      typeof path === 'string' ? new URL(path, `https://${host}`) : path;
    try {
      signal.throwIfAborted();
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'X-RapidAPI-Key': key,
          'X-RapidAPI-Host': host,
        },
        signal,
        redirect: 'error',
      });
      // RapidAPI can allow billable overages instead of returning 429. Stop
      // future cache misses when its quota headers say the allowance is gone.
      for (const prefix of [
        'x-ratelimit-requests',
        'x-rate-limit-rapid-free-plans-hard-limit',
      ]) {
        const remaining = response.headers.get(`${prefix}-remaining`);
        if (
          remaining != null &&
          /^-?\d+$/.test(remaining) &&
          Number(remaining) <= 0
        ) {
          const reset = response.headers.get(`${prefix}-reset`);
          const seconds = reset && /^\d+$/.test(reset) ? Number(reset) : 86_400;
          const delay = Math.min(
            31 * 86_400_000,
            Math.max(1000, seconds * 1000),
          );
          this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delay);
        }
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (allowNotFound && response.status === 404)
          throw new NotFoundException(
            'Carta não encontrada na API Pokémon TCG (TCGGO).',
          );
        if (response.status === 429) {
          const retry = response.headers.get('retry-after');
          const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : NaN;
          const dateMs = retry ? Date.parse(retry) - Date.now() : NaN;
          const delay = Number.isFinite(seconds)
            ? seconds * 1000
            : Number.isFinite(dateMs)
              ? dateMs
              : 60_000;
          this.blockedUntil = Math.max(
            this.blockedUntil,
            Date.now() + Math.min(86_400_000, Math.max(1000, delay)),
          );
          throw this.quotaError();
        }
        if (response.status === 401 || response.status === 403)
          throw new ServiceUnavailableException(
            'Acesso à API Pokémon TCG recusado. Verifique a chave e a assinatura no RapidAPI.',
          );
        throw new ServiceUnavailableException(
          'API Pokémon TCG (TCGGO) indisponível. Tente novamente mais tarde.',
        );
      }
      const payload: unknown = await response.json();
      signal.throwIfAborted();
      return payload;
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error &&
          ['TimeoutError', 'AbortError'].includes(error.name))
      )
        throw timedOut();
      if (error instanceof HttpException) throw error;
      if (error instanceof SyntaxError) invalid();
      throw new ServiceUnavailableException(
        'API Pokémon TCG (TCGGO) indisponível. Tente novamente mais tarde.',
      );
    }
  }

  private quotaError(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      'Limite de consultas da API Pokémon TCG atingido. Aguarde e confira sua cota no RapidAPI.',
    );
  }
}
