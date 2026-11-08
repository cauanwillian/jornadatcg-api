import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import request from 'supertest';
import { CardsModule } from './cards.module.js';
import { SearchCardsQueryPipe } from './dto/search-cards.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TcggoService } from './integrations/tcggo.service.js';

const episode = {
  id: 4,
  name: 'Paradox Rift',
  cards_printed_total: 182,
  cards_total: 266,
  code: 'PAR',
  released_at: '2023-11-03',
  series: { name: 'Scarlet & Violet' },
  logo: 'https://example.com/logo.png',
};
const card = {
  id: 25,
  name: 'Pikachu',
  card_number: '025',
  episode,
  rarity: 'Common',
  artist: { id: 1, name: 'Example' },
  image: 'https://example.com/pikachu.png',
  prices: { cardmarket: { lowest_near_mint: 10 } },
};
function pageBody(data: unknown[] = [card], page = 1, results = data.length) {
  return {
    data,
    paging: { current: page, total: Math.ceil(results / 20), per_page: 20 },
    results,
  };
}
function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
function pageResponse(
  data: unknown[] = [card],
  page = 1,
  results = data.length,
) {
  return jsonResponse(pageBody(data, page, results));
}

describe('GET /cards/search', () => {
  let app: INestApplication<App>;
  const fetchMock = vi.fn<typeof fetch>();
  const search = (query = '?name=Pikachu') =>
    request(app.getHttpServer()).get('/cards/search' + query);

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('TCGGO_RAPIDAPI_KEY', 'test-key');
    fetchMock.mockImplementation(async () => pageResponse());
    // Every test gets a provider with independent caches.
    const module = await Test.createTestingModule({ imports: [CardsModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('searches by name and returns only normalized fields', async () => {
    const response = await search().expect(200);
    expect(response.body).toEqual([
      {
        externalId: 'tcggo_25',
        name: card.name,
        number: card.card_number,
        set: { externalId: 'tcggo_4', name: episode.name, printedTotal: 182 },
        rarity: card.rarity,
        artist: card.artist.name,
        images: { small: card.image, large: card.image },
      },
    ]);
    const [url, options] = fetchMock.mock.calls[0];
    expect((url as URL).searchParams.get('name')).toBe('Pikachu');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.headers).toHaveProperty('X-RapidAPI-Key', 'test-key');
    expect(options?.headers).toHaveProperty(
      'X-RapidAPI-Host',
      'pokemon-tcg-api.p.rapidapi.com',
    );
  });

  it('parses 025/182 into number and printed total', () => {
    expect(new SearchCardsQueryPipe().transform({ code: '025/182' })).toEqual({
      code: { number: 25, printedTotal: 182 },
    });
  });

  it('matches padded and unpadded numbers, excluding incompatible cards', async () => {
    fetchMock.mockResolvedValueOnce(
      pageResponse([
        card,
        { ...card, id: 26, card_number: '25' },
        { ...card, id: 27, card_number: 25 },
        { ...card, id: 28, card_number: '125' },
        { ...card, id: 29, card_number: 'TG25' },
        { ...card, id: 30, episode: { ...episode, cards_printed_total: 183 } },
      ]),
    );
    const response = await search('?code=025/182').expect(200);
    expect(
      response.body.map((entry: { number: string }) => entry.number),
    ).toEqual(['025', '25', '25']);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('search')).toBe('25');
    expect(url.href).not.toContain('025%2F182');
  });

  it('combines name and code filters', async () => {
    await search('?name=Pikachu&code=025/182').expect(200);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('name')).toBe('Pikachu');
    expect(url.searchParams.get('search')).toBe('25');
  });

  it('normalizes the complete collector code observed in real TCGGO responses', async () => {
    fetchMock.mockResolvedValueOnce(
      pageResponse([{ ...card, card_number: '025/182' }]),
    );
    const response = await search('?code=025/182').expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0].number).toBe('025');
    expect(response.body[0].set.printedTotal).toBe(182);
  });

  it('uses set metadata for reprints instead of the denominator in the printed code', async () => {
    fetchMock.mockResolvedValueOnce(
      pageResponse([{ ...card, card_number: '025/102' }]),
    );
    const response = await search('?code=025/182').expect(200);
    expect(response.body[0].number).toBe('025');
    expect(response.body[0].set.printedTotal).toBe(182);
    await search('?code=025/102').expect(200, []);
  });

  it('preserves alphanumeric collector numbers while removing their denominator', async () => {
    fetchMock.mockResolvedValueOnce(
      pageResponse([{ ...card, card_number: 'TG05/TG30' }]),
    );
    const response = await search().expect(200);
    expect(response.body[0].number).toBe('TG05');
  });

  it.each(['025/', '/182', '025/182/200'])(
    'rejects a malformed printed code from the provider: %s',
    async (card_number) => {
      fetchMock.mockResolvedValueOnce(pageResponse([{ ...card, card_number }]));
      await search().expect(502);
    },
  );

  it.each([
    '',
    '?code=025-182',
    '?code=abc/182',
    '?code=25/0',
    '?code=1.5/182',
    '?code=-1/182',
    '?code=1/2/3',
    '?name=',
    '?name=%20',
    '?name=a&name=b',
    '?code=25/182&code=26/182',
    '?code=9007199254740992/182',
  ])('rejects invalid query %s before contacting upstream', async (query) => {
    await search(query).expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([0, 1])(
    'accepts an empty result with %s total pages',
    async (total) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          ...pageBody([]),
          paging: { current: 1, total, per_page: 20 },
        }),
      );
      await search('?name=Unknown').expect(200, []);
    },
  );
  it('returns an empty list if the set has no matching number', async () => {
    await search('?code=26/182').expect(200, []);
  });
  it('normalizes absent optional fields to null', async () => {
    fetchMock.mockResolvedValueOnce(
      pageResponse([
        {
          id: card.id,
          name: card.name,
          card_number: card.card_number,
          episode,
        },
      ]),
    );
    const response = await search().expect(200);
    expect(response.body[0]).toMatchObject({
      rarity: null,
      artist: null,
      images: { small: null, large: null },
    });
  });

  it('consumes subsequent pages and shares one deadline', async () => {
    fetchMock
      .mockResolvedValueOnce(
        pageResponse(
          Array.from({ length: 20 }, (_, index) => ({
            ...card,
            id: 100 + index,
            card_number: '125',
          })),
          1,
          21,
        ),
      )
      .mockResolvedValueOnce(pageResponse([card], 2, 21));
    const response = await search('?code=025/182').expect(200);
    expect(response.body).toHaveLength(1);
    expect((fetchMock.mock.calls[1][0] as URL).searchParams.get('page')).toBe(
      '2',
    );
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(
      fetchMock.mock.calls[1][1]?.signal,
    );
  });

  it('fetches an episode once when two cards omit their printed total', async () => {
    const partialEpisode = { id: episode.id, name: episode.name };
    fetchMock
      .mockResolvedValueOnce(
        pageResponse([
          { ...card, episode: partialEpisode },
          { ...card, id: 26, episode: partialEpisode },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ data: episode }));
    const response = await search('?code=025/182').expect(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0].set.printedTotal).toBe(182);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1][0] as URL).pathname).toBe('/episodes/4');
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(
      fetchMock.mock.calls[1][1]?.signal,
    );
  });
  it('does not replace an invalid present printed total with a detail lookup', async () => {
    fetchMock.mockResolvedValueOnce(
      pageResponse([
        {
          ...card,
          episode: { ...episode, cards_printed_total: -1 },
        },
      ]),
    );
    await search().expect(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends credentials only in headers', async () => {
    await search().expect(200);
    expect(fetchMock.mock.calls[0][1]?.headers).toHaveProperty(
      'X-RapidAPI-Key',
      'test-key',
    );
    expect((fetchMock.mock.calls[0][0] as URL).href).not.toContain('test-key');
  });
  it('requires the RapidAPI key before contacting the provider', async () => {
    vi.stubEnv('TCGGO_RAPIDAPI_KEY', '');
    await search().expect(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses the fixed RapidAPI host and a page size of twenty', async () => {
    await search().expect(200);
    const [target, options] = fetchMock.mock.calls[0];
    const url = target as URL;
    expect(url.origin).toBe('https://pokemon-tcg-api.p.rapidapi.com');
    expect(url.pathname).toBe('/cards');
    expect(url.searchParams.get('per_page')).toBe('20');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('q')).toBe(false);
    expect(options?.redirect).toBe('error');
  });

  it.each([
    { image: 42 },
    { artist: 'Example' },
    { artist: { name: 42 } },
    { episode: null },
    { id: 'sv4-25' },
    { card_number: -1 },
  ])('rejects malformed TCGGO card fields (%j)', async (fields) => {
    fetchMock.mockResolvedValueOnce(pageResponse([{ ...card, ...fields }]));
    await search().expect(502);
  });
  it('rejects an error envelope even when HTTP status is 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'secret details' }));
    const response = await search().expect(502);
    expect(response.text).not.toContain('secret');
  });
  it('sends punctuation as literal name text without a provider query expression', async () => {
    const name = 'Pika" OR name:*';
    await search('').query({ name }).expect(200);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.searchParams.get('name')).toBe(name);
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('search')).toBe(false);
  });
  it('enforces the timeout and returns 504', async () => {
    const signal = AbortSignal.timeout(1);
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          const requestSignal = options!.signal!;
          if (requestSignal.aborted) reject(requestSignal.reason);
          else
            requestSignal.addEventListener(
              'abort',
              () => reject(requestSignal.reason),
              { once: true },
            );
        }),
    );
    await search().expect(504);
    expect(timeout).toHaveBeenCalledWith(10_000);
  });
  it.each([401, 403, 429, 500, 503])(
    'maps upstream HTTP %s to a safe 503',
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        new Response('secret internal details', { status }),
      );
      const response = await search().expect(503);
      expect(response.text).not.toContain('secret');
      expect(response.text).not.toContain('test-key');
    },
  );
  it('sanitizes network errors', async () => {
    fetchMock.mockRejectedValueOnce(new Error('secret internal details'));
    const response = await search().expect(503);
    expect(response.text).not.toContain('secret');
  });

  it.each([
    'not json',
    JSON.stringify({}),
    JSON.stringify(pageBody([{ ...card, episode: null }])),
    JSON.stringify({ ...pageBody([]), results: 1 }),
    JSON.stringify({ ...pageBody(), results: -1 }),
    JSON.stringify({
      ...pageBody(),
      paging: { current: 2, total: 1, per_page: 20 },
    }),
    JSON.stringify({
      ...pageBody(),
      paging: { current: 1, total: -1, per_page: 20 },
    }),
    JSON.stringify({
      ...pageBody(),
      paging: { current: 1, total: 1, per_page: 21 },
    }),
  ])('maps malformed upstream payload to 502 (%s)', async (body) => {
    fetchMock.mockResolvedValueOnce(new Response(body));
    await search().expect(502);
  });
  it('rejects searches exceeding the page budget without returning partial results', async () => {
    fetchMock.mockResolvedValueOnce(
      pageResponse(
        Array.from({ length: 20 }, (_, index) => ({
          ...card,
          id: 100 + index,
        })),
        1,
        401,
      ),
    );
    const response = await search().expect(503);
    expect(response.body).not.toBeInstanceOf(Array);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses successful searches for five minutes', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    await search().expect(200);
    now += 299_000;
    await search().expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 2_000;
    await search().expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('shares an in-flight search between simultaneous callers', async () => {
    let release!: (response: Response) => void;
    let entered!: () => void;
    const fetching = new Promise<void>((resolve) => {
      entered = resolve;
    });
    fetchMock.mockImplementationOnce(() => {
      entered();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const provider = app.get(TcggoService);
    const first = provider.search({ name: 'Pikachu' });
    const second = provider.search({ name: 'Pikachu' });
    await fetching;
    release(pageResponse());
    const responses = await Promise.all([first, second]);
    expect(responses[0]).toEqual(responses[1]);
    expect(responses[0]).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('does not cache malformed upstream responses', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await search().expect(502);
    await search().expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('keeps an earlier caller deadline while sharing a later episode lookup', async () => {
    const firstController = new AbortController();
    const secondController = new AbortController();
    vi.spyOn(AbortSignal, 'timeout')
      .mockReturnValueOnce(firstController.signal)
      .mockReturnValueOnce(secondController.signal);
    const partialCard = {
      ...card,
      episode: { id: episode.id, name: episode.name },
    };
    let releaseFirstCards!: (response: Response) => void;
    let releaseEpisode!: (response: Response) => void;
    let episodeEntered!: () => void;
    const fetchingEpisode = new Promise<void>((resolve) => {
      episodeEntered = resolve;
    });
    fetchMock.mockImplementation((target) => {
      const url = target as URL;
      if (url.pathname === '/episodes/4') {
        episodeEntered();
        return new Promise<Response>((resolve) => {
          releaseEpisode = resolve;
        });
      }
      if (url.searchParams.get('name') === 'First') {
        return new Promise<Response>((resolve) => {
          releaseFirstCards = resolve;
        });
      }
      return Promise.resolve(pageResponse([partialCard]));
    });
    const provider = app.get(TcggoService);
    const first = provider.search({ name: 'First' }).then(
      () => {
        throw new Error('Expected the earlier search to time out.');
      },
      (error: unknown) => error,
    );
    let secondSettled = false;
    const second = provider.search({ name: 'Second' }).finally(() => {
      secondSettled = true;
    });
    await fetchingEpisode;
    releaseFirstCards(pageResponse([partialCard]));
    // Drain response parsing and normalization before expiring the first caller.
    await new Promise<void>((resolve) => setImmediate(resolve));
    firstController.abort(new DOMException('Expired', 'TimeoutError'));
    expect(await first).toMatchObject({ status: 504 });
    expect(secondSettled).toBe(false);
    releaseEpisode(jsonResponse({ data: episode }));
    expect(await second).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('backs off for sixty seconds after an upstream quota response', async () => {
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    fetchMock.mockResolvedValueOnce(
      new Response('quota details', { status: 429 }),
    );
    await search().expect(503);
    await search('?name=Eevee').expect(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    now += 61_000;
    await search('?name=Eevee').expect(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each(['x-ratelimit-requests', 'x-rate-limit-rapid-free-plans-hard-limit'])(
    'honors exhausted %s quota headers even on a successful response',
    async (prefix) => {
      let now = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      const response = pageResponse();
      response.headers.set(prefix + '-remaining', '0');
      response.headers.set(prefix + '-reset', '2');
      fetchMock.mockResolvedValueOnce(response);
      await search().expect(200);
      await search('?name=Eevee').expect(503);
      await search().expect(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      now += 3_000;
      await search('?name=Eevee').expect(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
});
