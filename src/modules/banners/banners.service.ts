import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../../database/prisma.service.js';
const select = {
  id: true,
  title: true,
  link: true,
  active: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;
function dto(row: { id: string; updatedAt: Date }) {
  return {
    ...row,
    imageUrl: `/banners/${row.id}/image?v=${row.updatedAt.getTime()}`,
  };
}
@Injectable()
export class BannersService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2025')
        throw new NotFoundException('Banner não encontrado.');
      throw new ServiceUnavailableException(
        'Banners temporariamente indisponíveis.',
      );
    }
  }
  async normalize(file?: { buffer: Buffer }) {
    if (!file?.buffer?.length || file.buffer.length > 5 * 1024 * 1024)
      throw new BadRequestException(
        'Envie uma imagem de até 5 MB no campo image.',
      );
    try {
      const image = sharp(file.buffer, { limitInputPixels: 1600 * 500 });
      const m = await image.metadata();
      if (
        !['png', 'jpeg', 'webp'].includes(m.format ?? '') ||
        m.width !== 1600 ||
        m.height !== 500 ||
        (m.pages ?? 1) !== 1 ||
        (m.orientation ?? 1) >= 5
      )
        throw Error();
      return await image.rotate().webp({ quality: 85 }).toBuffer();
    } catch {
      throw new BadRequestException(
        'Use PNG, JPEG ou WebP estático de 1600 × 500 pixels.',
      );
    }
  }
  list(admin = false) {
    return this.safe(async () => ({
      data: (
        await this.db.banner.findMany({
          where: admin ? {} : { active: true },
          select,
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take: admin ? 100 : 20,
        })
      ).map(dto),
    }));
  }
  create(
    data: {
      title: string;
      link?: string | null;
      active?: boolean;
      sortOrder?: number;
    },
    image: Buffer,
  ) {
    return this.safe(async () =>
      dto(
        await this.db.banner.create({
          data: { ...data, image: new Uint8Array(image) },
          select,
        }),
      ),
    );
  }
  update(
    id: string,
    data: {
      title?: string;
      link?: string | null;
      active?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.safe(async () =>
      dto(await this.db.banner.update({ where: { id }, data, select })),
    );
  }
  replace(id: string, image: Buffer) {
    return this.safe(async () =>
      dto(
        await this.db.banner.update({
          where: { id },
          data: { image: new Uint8Array(image) },
          select,
        }),
      ),
    );
  }
  remove(id: string) {
    return this.safe(async () => {
      await this.db.banner.delete({ where: { id } });
    });
  }
  image(id: string, admin = false) {
    return this.safe(async () => {
      const row = await this.db.banner.findFirst({
        where: { id, ...(admin ? {} : { active: true }) },
        select: { image: true },
      });
      if (!row) throw new NotFoundException('Banner não encontrado.');
      return Buffer.from(row.image);
    });
  }
}
