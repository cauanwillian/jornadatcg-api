import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CatalogModule } from './catalog.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
const id = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
const product = {
  id,
  price: new Prisma.Decimal('12.50'),
  observation: null,
  createdAt: new Date('2026-01-01'),
  card: {
    id,
    name: 'Pikachu',
    number: '025',
    rarity: 'Rare',
    artist: null,
    imageSmall: null,
    imageLarge: null,
    set: { id, name: 'Set' },
  },
  category: { id, name: 'Cards', slug: 'cards' },
  condition: { id, name: 'NM', code: 'NM' },
  language: { id, name: 'Português', code: 'PT' },
  inventory: { availableQuantity: 2 },
};
describe('Public catalog HTTP', () => {
  it('lists only visible featured products with available stock in administrative order', async () => {
    const response = await request(app.getHttpServer())
      .get('/catalog/featured')
      .expect(200);
    expect(response.body.data[0].price).toBe('12.50');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(db.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          active: true,
          featured: true,
          category: { active: true },
          condition: { active: true },
          language: { active: true },
          inventory: { is: { availableQuantity: { gt: 0 } } },
        },
        orderBy: [{ featuredOrder: 'asc' }, { id: 'asc' }],
        take: 24,
      }),
    );
  });
  it('returns an empty featured list normally', async () => {
    db.product.findMany.mockResolvedValue([]);
    const response = await request(app.getHttpServer())
      .get('/catalog/featured')
      .expect(200);
    expect(response.body).toEqual({ data: [] });
  });
  let app: INestApplication;
  const db = {
    product: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      aggregate: vi.fn(),
    },
    category: { findMany: vi.fn() },
    condition: { findMany: vi.fn() },
    language: { findMany: vi.fn() },
    card: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  beforeEach(async () => {
    vi.resetAllMocks();
    db.$transaction.mockImplementation((work) => work(db));
    db.product.count.mockResolvedValue(25);
    db.product.findMany.mockResolvedValue([product]);
    db.product.findFirst.mockResolvedValue(product);
    db.category.findMany.mockResolvedValue([]);
    db.condition.findMany.mockResolvedValue([]);
    db.language.findMany.mockResolvedValue([]);
    db.card.findMany.mockResolvedValue([{ rarity: 'Rare' }]);
    db.product.aggregate.mockResolvedValue({
      _min: { price: new Prisma.Decimal(1) },
      _max: { price: new Prisma.Decimal(20) },
    });
    const module = await Test.createTestingModule({ imports: [CatalogModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });
  it('lists without authentication and exposes only public data', async () => {
    const r = await request(app.getHttpServer())
      .get('/catalog/products')
      .expect(200);
    expect(r.body.data[0]).toMatchObject({
      price: '12.50',
      availableQuantity: 2,
      inStock: true,
    });
    expect(r.body.data[0]).not.toHaveProperty('inventory');
    expect(r.body.pagination.hasMore).toBe(true);
    expect(db.product.findMany.mock.calls[0][0].where).toMatchObject({
      active: true,
      category: { active: true },
      condition: { active: true },
      language: { active: true },
    });
  });
  it('combines filters and deterministic sorting', async () => {
    await request(app.getHttpServer())
      .get(
        `/catalog/products?name=Pika&minPrice=0&maxPrice=20&categoryId=${id}&conditionId=${id}&languageId=${id}&rarity=Rare&stock=available&sort=price_asc&page=2&limit=10`,
      )
      .expect(200);
    const q = db.product.findMany.mock.calls[0][0];
    expect(q).toMatchObject({
      skip: 10,
      take: 10,
      orderBy: [{ price: 'asc' }, { id: 'asc' }],
      where: {
        categoryId: id,
        conditionId: id,
        languageId: id,
        card: {
          rarity: 'Rare',
          name: { contains: 'Pika', mode: 'insensitive' },
        },
        inventory: { is: { availableQuantity: { gt: 0 } } },
      },
    });
    expect(q.where.price.gte.toString()).toBe('0');
  });
  it.each(['price_desc', 'newest', 'oldest'])(
    'accepts sort %s',
    async (sort) => {
      await request(app.getHttpServer())
        .get(`/catalog/products?sort=${sort}`)
        .expect(200);
    },
  );
  it.each([
    'page=0',
    'limit=101',
    'minPrice=-1',
    'minPrice=10&maxPrice=2',
    'sort=invalid',
    'active=false',
    'name=a&name=b',
    'stock=yes',
    'categoryId=bad',
    'name=',
    'maxPrice=Infinity',
  ])('rejects invalid query %s', async (query) => {
    await request(app.getHttpServer())
      .get(`/catalog/products?${query}`)
      .expect(400);
    expect(db.product.findMany).not.toHaveBeenCalled();
  });
  it('returns empty results normally', async () => {
    db.product.count.mockResolvedValue(0);
    db.product.findMany.mockResolvedValue([]);
    const r = await request(app.getHttpServer())
      .get('/catalog/products')
      .expect(200);
    expect(r.body).toMatchObject({
      data: [],
      pagination: { total: 0, hasMore: false },
    });
  });
  it('treats absent inventory as unavailable and filters both cases', async () => {
    db.product.findMany.mockResolvedValue([{ ...product, inventory: null }]);
    const r = await request(app.getHttpServer())
      .get('/catalog/products?stock=unavailable')
      .expect(200);
    expect(r.body.data[0]).toMatchObject({
      availableQuantity: 0,
      inStock: false,
    });
    expect(db.product.findMany.mock.calls[0][0].where.OR).toHaveLength(2);
  });
  it('escapes wildcard characters in name searches', async () => {
    await request(app.getHttpServer())
      .get('/catalog/products')
      .query({ name: '50%_' })
      .expect(200);
    expect(db.product.findMany.mock.calls[0][0].where.card.name.contains).toBe(
      '50\\%\\_',
    );
  });
  it('returns public detail and hides inactive or missing products', async () => {
    await request(app.getHttpServer())
      .get(`/catalog/products/${id}`)
      .expect(200);
    expect(db.product.findFirst.mock.calls[0][0].where).toMatchObject({
      id,
      active: true,
    });
    db.product.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`/catalog/products/${id}`)
      .expect(404);
    await request(app.getHttpServer()).get('/catalog/products/bad').expect(400);
  });
  it('returns filter metadata with normalized prices', async () => {
    const r = await request(app.getHttpServer())
      .get('/catalog/filters')
      .expect(200);
    expect(r.body).toMatchObject({
      rarities: ['Rare'],
      priceRange: { min: '1.00', max: '20.00' },
    });
    expect(
      db.category.findMany.mock.calls[0][0].where.products.some.active,
    ).toBe(true);
  });
  it('sanitizes database failures', async () => {
    db.product.findFirst.mockRejectedValue(new Error('secret'));
    const r = await request(app.getHttpServer())
      .get(`/catalog/products/${id}`)
      .expect(503);
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });
});
