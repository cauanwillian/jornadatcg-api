import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ScrydexService } from './integrations/scrydex.service.js';
import { localCardSelect, toLocalCardDto } from './dto/local-card.dto.js';
import type { CardsPageDto, LocalCardDto } from './dto/local-card.dto.js';
import type { ListCardsDto } from './dto/list-cards.dto.js';

@Injectable()
export class CardsCatalogService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ScrydexService) private readonly scrydex: ScrydexService,
  ) {}

  async importCard(externalId: string): Promise<LocalCardDto> {
    // Remote I/O and validation must finish before acquiring database locks.
    const source = await this.scrydex.getById(externalId);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const card = await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.card.findUnique({
              where: { externalId },
              select: localCardSelect,
            });
            if (existing) return existing;
            const set = await tx.cardSet.upsert({
              where: { externalId: source.set.id },
              update: {},
              create: {
                externalId: source.set.id,
                name: source.set.name,
                printedTotal: source.set.printedTotal,
                total: source.set.total ?? null,
                series: source.set.series ?? null,
                code: source.set.code ?? null,
                releaseDate: source.set.releaseDate
                  ? new Date(
                      `${source.set.releaseDate.replaceAll('/', '-')}T00:00:00.000Z`,
                    )
                  : null,
                logoUrl: source.set.images?.logo ?? null,
                symbolUrl: source.set.images?.symbol ?? null,
              },
            });
            const collision = await tx.card.findUnique({
              where: { setId_number: { setId: set.id, number: source.number } },
              select: { id: true },
            });
            if (collision)
              throw new ConflictException(
                'Já existe outra carta com este número na coleção.',
              );
            return tx.card.create({
              data: {
                externalId,
                name: source.name,
                number: source.number,
                rarity: source.rarity ?? null,
                artist: source.artist ?? null,
                imageSmall: source.images?.small ?? null,
                imageLarge: source.images?.large ?? null,
                setId: set.id,
              },
              select: localCardSelect,
            });
          },
          { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 5_000 },
        );
        return toLocalCardDto(card);
      } catch (error) {
        const code = this.errorCode(error);
        // A concurrent import can win either unique key or cause a serialization retry.
        if ((code === 'P2002' || code === 'P2034') && attempt < 2) continue;
        if (code === 'P2002')
          throw new ConflictException(
            'Conflito ao importar a carta. Consulte o catálogo e tente novamente.',
          );
        this.rethrowDatabaseError(error);
      }
    }
    throw new ServiceUnavailableException(
      'Catálogo temporariamente indisponível.',
    );
  }

  async list(query: ListCardsDto): Promise<CardsPageDto> {
    const where: Prisma.CardWhereInput = {
      ...(query.name
        ? {
            name: {
              contains: query.name.replace(/[\\%_]/g, '\\$&'),
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.setId ? { setId: query.setId } : {}),
    };
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const total = await tx.card.count({ where });
          const cards = await tx.card.findMany({
            where,
            select: localCardSelect,
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.limit,
            take: query.limit,
          });
          return { total, cards };
        },
        { isolationLevel: 'RepeatableRead' },
      );
      return {
        data: result.cards.map(toLocalCardDto),
        pagination: {
          page: query.page,
          limit: query.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / query.limit),
        },
      };
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  async findById(id: string): Promise<LocalCardDto> {
    try {
      const card = await this.prisma.card.findUnique({
        where: { id },
        select: localCardSelect,
      });
      if (!card)
        throw new NotFoundException('Carta não encontrada no catálogo.');
      return toLocalCardDto(card);
    } catch (error) {
      this.rethrowDatabaseError(error);
    }
  }

  private errorCode(error: unknown): string | undefined {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
    )
      return error.code;
    return undefined;
  }

  private rethrowDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Catálogo temporariamente indisponível. Tente novamente mais tarde.',
    );
  }
}
