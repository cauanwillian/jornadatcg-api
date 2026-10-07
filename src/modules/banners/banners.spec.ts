import { Test } from '@nestjs/testing';
import type { INestApplication, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import { BannersModule } from './banners.module.js';
import { PrismaService } from '../../database/prisma.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { bannerInput } from './banner-input.js';
const id = 'a99d3fe9-a5fb-4f35-9218-88592106d61f';
describe('Banners HTTP', () => {
  let app: INestApplication;
  let image: Buffer;
  const row = {
    id,
    title: 'Banner',
    link: null,
    active: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const db = {
    banner: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  beforeAll(async () => {
    image = await sharp({
      create: { width: 1600, height: 500, channels: 3, background: '#b2190b' },
    })
      .png()
      .toBuffer();
  });
  beforeEach(async () => {
    vi.resetAllMocks();
    db.banner.findMany.mockResolvedValue([row]);
    db.banner.findFirst.mockResolvedValue({ image });
    db.banner.create.mockResolvedValue(row);
    db.banner.update.mockResolvedValue(row);
    const mod = await Test.createTestingModule({ imports: [BannersModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          const req = ctx.switchToHttp().getRequest();
          if (!req.headers.authorization) return false;
          req.user = {
            id,
            role: req.headers.authorization === 'admin' ? 'ADMIN' : 'CUSTOMER',
          };
          return true;
        },
      })
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });
  it('lists public active metadata without bytes', async () => {
    const r = await request(app.getHttpServer()).get('/banners').expect(200);
    expect(r.body.data[0].imageUrl).toContain(`/banners/${id}/image`);
    expect(r.body.data[0]).not.toHaveProperty('image');
    expect(db.banner.findMany.mock.calls[0][0].where).toEqual({ active: true });
  });
  it('blocks visitors and customers from writing', async () => {
    await request(app.getHttpServer()).post('/admin/banners').expect(403);
    await request(app.getHttpServer())
      .post('/admin/banners')
      .set('Authorization', 'customer')
      .expect(403);
    expect(db.banner.create).not.toHaveBeenCalled();
  });
  it('uploads and transcodes a valid image', async () => {
    await request(app.getHttpServer())
      .post('/admin/banners')
      .set('Authorization', 'admin')
      .field('title', 'Promo')
      .field('active', 'true')
      .attach('image', image, 'banner.png')
      .expect(201);
    const data = db.banner.create.mock.calls[0][0].data;
    expect(data.active).toBe(true);
    expect((await sharp(data.image).metadata()).format).toBe('webp');
  });
  it('rejects missing and counterfeit images', async () => {
    await request(app.getHttpServer())
      .post('/admin/banners')
      .set('Authorization', 'admin')
      .field('title', 'Promo')
      .expect(400);
    await request(app.getHttpServer())
      .post('/admin/banners')
      .set('Authorization', 'admin')
      .field('title', 'Promo')
      .attach('image', Buffer.from('<svg/>'), 'banner.png')
      .expect(400);
  });
  it('rejects oversized uploads', async () => {
    await request(app.getHttpServer())
      .post('/admin/banners')
      .set('Authorization', 'admin')
      .field('title', 'Promo')
      .attach('image', Buffer.alloc(5 * 1024 * 1024 + 1), 'banner.png')
      .expect(413);
  });
  it('rejects wrong dimensions', async () => {
    const small = await sharp(image).resize(100, 100).png().toBuffer();
    await request(app.getHttpServer())
      .post('/admin/banners')
      .set('Authorization', 'admin')
      .field('title', 'Promo')
      .attach('image', small, 'banner.png')
      .expect(400);
  });
  it('updates activation and removes banners', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/banners/${id}`)
      .set('Authorization', 'admin')
      .send({ active: false, sortOrder: 2 })
      .expect(200);
    expect(db.banner.update.mock.calls[0][0].data).toEqual({
      active: false,
      sortOrder: 2,
    });
    await request(app.getHttpServer())
      .delete(`/admin/banners/${id}`)
      .set('Authorization', 'admin')
      .expect(204);
  });
  it('serves image and hides inactive or missing banners', async () => {
    await request(app.getHttpServer())
      .get(`/banners/${id}/image`)
      .expect('Content-Type', /image\/webp/)
      .expect(200);
    expect(db.banner.findFirst.mock.calls[0][0].where).toEqual({
      id,
      active: true,
    });
    db.banner.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer()).get(`/banners/${id}/image`).expect(404);
  });
  it('replaces image without changing metadata', async () => {
    await request(app.getHttpServer())
      .post(`/admin/banners/${id}/image`)
      .set('Authorization', 'admin')
      .attach('image', image, 'banner.png')
      .expect(200);
    expect(Object.keys(db.banner.update.mock.calls[0][0].data)).toEqual([
      'image',
    ]);
  });
  it('sanitizes database errors', async () => {
    db.banner.findMany.mockRejectedValue(new Error('secret'));
    const r = await request(app.getHttpServer()).get('/banners').expect(503);
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });
  it.each([
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/%2fevil',
    'javascript:alert(1)',
  ])('rejects unsafe links %s', (link) => {
    expect(() => bannerInput({ title: 'Promo', link })).toThrow();
  });
});
