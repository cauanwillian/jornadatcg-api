import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import request from 'supertest';
import { CardsModule } from './cards.module.js';
import { SearchCardsQueryPipe } from './dto/search-cards.dto.js';
import { PrismaService } from '../../database/prisma.service.js';

const card = {
  id: 'sv4-25',
  name: 'Pikachu',
  number: '025',
  expansion: {
    id: 'sv4',
    name: 'Paradox Rift',
    printed_total: 182,
    total: 266,
  },
  rarity: 'Common',
  artist: 'Example',
  images: [
    {
      type: 'front',
      small: 'https://example.com/small.png',
      large: 'https://example.com/large.png',
    },
  ],
  tcgplayer: { prices: { market: 10 } },
};

function pageResponse(
  data: unknown[] = [card],
  page = 1,
  totalCount = data.length,
) {
  return new Response(
    JSON.stringify({
      data,
      page,
      pageSize: 100,
      status: 'success',
      totalCount,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

describe('GET /cards/search', () => {
  let app: INestApplication<App>;
  const fetchMock = vi.fn<typeof fetch>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [CardsModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('SCRYDEX_API_KEY', 'test-key');
    vi.stubEnv('SCRYDEX_TEAM_ID', 'test-team');
    fetchMock.mockResolvedValue(pageResponse());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await app.close();
  });

  it('searches by name and returns only normalized fields', async () => {
    const response = await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(200);
    expect(response.body).toEqual([
      {
        externalId: card.id,
        name: card.name,
        number: card.number,
        set: {
          externalId: card.expansion.id,
          name: card.expansion.name,
          printedTotal: 182,
        },
        rarity: card.rarity,
        artist: card.artist,
        images: { small: card.images[0].small, large: card.images[0].large },
      },
    ]);
    const [url, options] = fetchMock.mock.calls[0];
    expect((url as URL).searchParams.get('q')).toBe('name:"Pikachu"');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(options?.headers).toHaveProperty('X-Api-Key', 'test-key');
    expect(options?.headers).toHaveProperty('X-Team-ID', 'test-team');
  });

  it('parses 025/182 into number and printed total', () => {
    expect(new SearchCardsQueryPipe().transform({ code: '025/182' })).toEqual({
      code: { number: 25, printedTotal: 182 },
    });
  });

  it('matches padded and unpadded numbers, excluding incompatible cards', async () => {
    fetchMock.mockResolvedValue(
      pageResponse([
        card,
        { ...card, id: 'other-25', number: '25' },
        { ...card, number: '26' },
        { ...card, number: 'TG25' },
        { ...card, expansion: { ...card.expansion, printed_total: 183 } },
      ]),
    );
    const response = await request(app.getHttpServer())
      .get('/cards/search?code=025/182')
      .expect(200);
    expect(response.body).toHaveLength(2);
    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get('q')).toBe(
      'expansion.printed_total:182',
    );
  });

  it('combines name and code filters', async () => {
    await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu&code=025/182')
      .expect(200);
    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get('q')).toBe(
      'name:"Pikachu" expansion.printed_total:182',
    );
  });

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
    await request(app.getHttpServer()).get(`/cards/search${query}`).expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an empty list when there are no matches', async () => {
    fetchMock.mockResolvedValue(pageResponse([]));
    await request(app.getHttpServer())
      .get('/cards/search?name=Unknown')
      .expect(200, []);
  });

  it('returns an empty list if the set has no matching number', async () => {
    await request(app.getHttpServer())
      .get('/cards/search?code=26/182')
      .expect(200, []);
  });

  it('normalizes absent optional fields to null', async () => {
    fetchMock.mockResolvedValue(
      pageResponse([
        {
          id: card.id,
          name: card.name,
          number: card.number,
          expansion: card.expansion,
        },
      ]),
    );
    const response = await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(200);
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
          Array.from({ length: 100 }, (_, index) => ({
            ...card,
            id: `card-${index}`,
            number: '1',
          })),
          1,
          101,
        ),
      )
      .mockResolvedValueOnce(pageResponse([card], 2, 101));
    const response = await request(app.getHttpServer())
      .get('/cards/search?code=025/182')
      .expect(200);
    expect(response.body).toHaveLength(1);
    expect((fetchMock.mock.calls[1][0] as URL).searchParams.get('page')).toBe(
      '2',
    );
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(
      fetchMock.mock.calls[1][1]?.signal,
    );
  });

  it('sends the credentials only in headers', async () => {
    vi.stubEnv('SCRYDEX_API_KEY', 'test-key');
    await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(200);
    expect(fetchMock.mock.calls[0][1]?.headers).toHaveProperty(
      'X-Api-Key',
      'test-key',
    );
    expect((fetchMock.mock.calls[0][0] as URL).href).not.toContain('test-key');
    expect((fetchMock.mock.calls[0][0] as URL).href).not.toContain('test-team');
  });

  it.each(['SCRYDEX_API_KEY', 'SCRYDEX_TEAM_ID'])(
    'requires %s before contacting the provider',
    async (variable) => {
      vi.stubEnv(variable, '');
      await request(app.getHttpServer())
        .get('/cards/search?name=Pikachu')
        .expect(503);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('uses the Scrydex host, page limit and field selection without prices', async () => {
    await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(200);
    const url = fetchMock.mock.calls[0][0] as URL;
    expect(url.origin).toBe('https://api.scrydex.com');
    expect(url.pathname).toBe('/pokemon/v1/cards');
    expect(url.searchParams.get('pageSize')).toBe('100');
    expect(url.searchParams.get('casing')).toBe('snake');
    expect(url.searchParams.get('select')).toContain('expansion');
    expect(url.searchParams.has('include')).toBe(false);
  });

  it('accepts snake case pagination without a count field', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          data: [card],
          page: 1,
          page_size: 100,
          total_count: 1,
        }),
      ),
    );
    await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(200);
  });

  it('selects the front image even when the back image comes first', async () => {
    fetchMock.mockResolvedValue(
      pageResponse([
        {
          ...card,
          images: [
            { type: 'back', small: 'back-small', large: 'back-large' },
            ...card.images,
          ],
        },
      ]),
    );
    const response = await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(200);
    expect(response.body[0].images).toEqual({
      small: card.images[0].small,
      large: card.images[0].large,
    });
  });

  it('does not substitute a back image when no front exists', async () => {
    fetchMock.mockResolvedValue(
      pageResponse([
        { ...card, images: [{ type: 'back', small: 'back-small' }] },
      ]),
    );
    const response = await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(200);
    expect(response.body[0].images).toEqual({ small: null, large: null });
  });

  it.each([
    { images: {} },
    { images: [{ type: 'front', small: 42 }] },
    { expansion: null },
  ])('rejects malformed Scrydex card fields (%j)', async (fields) => {
    fetchMock.mockResolvedValue(pageResponse([{ ...card, ...fields }]));
    await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(502);
  });

  it('rejects an error envelope even when HTTP status is 200', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'error',
          data: [],
          page: 1,
          page_size: 100,
          total_count: 0,
        }),
      ),
    );
    await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(502);
  });

  it('escapes query operators in names', async () => {
    await request(app.getHttpServer())
      .get('/cards/search')
      .query({ name: 'Pika" OR name:*' })
      .expect(200);
    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get('q')).toBe(
      'name:"Pika\\" OR name\\:\\*"',
    );
  });

  it('enforces the timeout and returns 504', async () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(AbortSignal.timeout(1));
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          const signal = options!.signal!;
          if (signal.aborted) reject(signal.reason);
          else
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
        }),
    );
    await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(504);
    expect(timeout).toHaveBeenCalledWith(10_000);
  });

  it.each([401, 429, 500, 503])(
    'maps upstream HTTP %s to a safe 503',
    async (status) => {
      fetchMock.mockResolvedValue(
        new Response('secret internal details', { status }),
      );
      const response = await request(app.getHttpServer())
        .get('/cards/search?name=Pikachu')
        .expect(503);
      expect(response.text).not.toContain('secret');
    },
  );

  it('sanitizes network errors', async () => {
    fetchMock.mockRejectedValue(new Error('secret internal details'));
    const response = await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(503);
    expect(response.text).not.toContain('secret');
  });

  it.each([
    'not json',
    JSON.stringify({}),
    JSON.stringify({
      data: [{ ...card, expansion: null }],
      page: 1,
      pageSize: 100,
      count: 1,
      totalCount: 1,
    }),
    JSON.stringify({
      data: [],
      page: 1,
      pageSize: 100,
      count: 0,
      totalCount: 1,
    }),
    JSON.stringify({
      data: [card],
      page: 1,
      pageSize: 100,
      count: 1,
      totalCount: -1,
    }),
  ])('maps malformed upstream payload to 502 (%s)', async (body) => {
    fetchMock.mockResolvedValue(new Response(body));
    await request(app.getHttpServer())
      .get('/cards/search?name=Pikachu')
      .expect(502);
  });
});
