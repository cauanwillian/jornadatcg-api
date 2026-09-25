import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { productSelect, toProductDto } from './dto/product-result.dto.js';
import type {
  CreateProductDto,
  UpdateProductDto,
  InventoryDto,
  ListProductsDto,
  ReferenceDto,
  ReferenceKind,
} from './dto/products.dto.js';

@Injectable()
export class ProductsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateProductDto) {
    return this.transaction(async (tx) => {
      await this.validateReferences(tx, input);
      const { availableQuantity, price, ...data } = input;
      return toProductDto(
        await tx.product.create({
          data: {
            ...data,
            price: new Prisma.Decimal(price),
            inventory: {
              create: {
                availableQuantity,
                reservedQuantity: 0,
                soldQuantity: 0,
              },
            },
          },
          select: productSelect,
        }),
      );
    });
  }

  async update(id: string, input: UpdateProductDto) {
    return this.transaction(async (tx) => {
      if (
        !(await tx.product.findUnique({ where: { id }, select: { id: true } }))
      )
        throw new NotFoundException('Produto não encontrado.');
      await this.validateReferences(tx, input);
      return toProductDto(
        await tx.product.update({
          where: { id },
          data: {
            ...input,
            ...(input.price ? { price: new Prisma.Decimal(input.price) } : {}),
          },
          select: productSelect,
        }),
      );
    });
  }

  async updateInventory(id: string, input: InventoryDto) {
    return this.transaction(async (tx) => {
      if (
        !(await tx.product.findUnique({ where: { id }, select: { id: true } }))
      )
        throw new NotFoundException('Produto não encontrado.');
      // Compare-and-set in one UPDATE: concurrent changes cannot be overwritten.
      const result = await tx.inventory.updateMany({
        where: {
          productId: id,
          availableQuantity: input.expectedAvailableQuantity,
        },
        data: { availableQuantity: input.availableQuantity },
      });
      if (result.count !== 1)
        throw new ConflictException(
          'Estoque alterado por outra operação ou não cadastrado. Consulte o produto antes de tentar novamente.',
        );
      return toProductDto(
        await tx.product.findUniqueOrThrow({
          where: { id },
          select: productSelect,
        }),
      );
    });
  }

  async list(query: ListProductsDto) {
    const where: Prisma.ProductWhereInput = {
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.cardId ? { cardId: query.cardId } : {}),
      ...(query.name
        ? {
            card: {
              name: {
                contains: query.name.replace(/[\\%_]/g, '\\$&'),
                mode: 'insensitive',
              },
            },
          }
        : {}),
    };
    return this.transaction(async (tx) => {
      const total = await tx.product.count({ where });
      const data = await tx.product.findMany({
        where,
        select: productSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: (query.page - 1) * query.limit,
      });
      return {
        data: data.map(toProductDto),
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
      };
    }, 'RepeatableRead');
  }

  async findById(id: string) {
    try {
      const product = await this.prisma.product.findUnique({
        where: { id },
        select: productSelect,
      });
      if (!product) throw new NotFoundException('Produto não encontrado.');
      return toProductDto(product);
    } catch (error) {
      this.databaseError(error);
    }
  }

  async options() {
    return this.transaction(
      async (tx) => ({
        categories: await tx.category.findMany({
          where: { active: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, slug: true, description: true },
        }),
        conditions: await tx.condition.findMany({
          where: { active: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, code: true, description: true },
        }),
        languages: await tx.language.findMany({
          where: { active: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, code: true },
        }),
      }),
      'RepeatableRead',
    );
  }

  async createReference(kind: ReferenceKind, input: ReferenceDto) {
    try {
      if (kind === 'category')
        return await this.prisma.category.create({
          data: {
            name: input.name,
            slug: input.slug!,
            description: input.description,
            active: true,
          },
          select: { id: true, name: true, slug: true, description: true },
        });
      if (kind === 'condition')
        return await this.prisma.condition.create({
          data: {
            name: input.name,
            code: input.code!,
            description: input.description,
            active: true,
          },
          select: { id: true, name: true, code: true, description: true },
        });
      return await this.prisma.language.create({
        data: { name: input.name, code: input.code!, active: true },
        select: { id: true, name: true, code: true },
      });
    } catch (error) {
      this.databaseError(error);
    }
  }

  private async validateReferences(
    tx: Prisma.TransactionClient,
    input: UpdateProductDto,
  ) {
    if (
      input.cardId &&
      !(await tx.card.findUnique({
        where: { id: input.cardId },
        select: { id: true },
      }))
    )
      throw new BadRequestException('Carta não cadastrada no catálogo local.');
    for (const [key, model, label] of [
      ['categoryId', 'category', 'Categoria'],
      ['conditionId', 'condition', 'Condição'],
      ['languageId', 'language', 'Idioma'],
    ] as const) {
      const id = input[key];
      if (!id) continue;
      const args = {
        where: { id, active: true },
        select: { id: true },
      } as const;
      const record =
        model === 'category'
          ? await tx.category.findFirst(args)
          : model === 'condition'
            ? await tx.condition.findFirst(args)
            : await tx.language.findFirst(args);
      if (!record)
        throw new BadRequestException(`${label} inexistente ou inativo.`);
    }
  }

  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    isolationLevel: Prisma.TransactionIsolationLevel = 'Serializable',
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel,
          maxWait: 5000,
          timeout: 5000,
        });
      } catch (error) {
        if (this.code(error) === 'P2034' && attempt < 2) continue;
        this.databaseError(error);
      }
    }
    throw new ServiceUnavailableException(
      'Produtos temporariamente indisponíveis.',
    );
  }

  private code(error: unknown): unknown {
    return error && typeof error === 'object' && 'code' in error
      ? error.code
      : undefined;
  }
  private databaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (this.code(error) === 'P2002')
      throw new ConflictException(
        'Já existe um cadastro com este nome, código ou slug.',
      );
    if (this.code(error) === 'P2003')
      throw new BadRequestException(
        'Uma referência do produto não está disponível.',
      );
    if (this.code(error) === 'P2025')
      throw new NotFoundException('Produto não encontrado.');
    if (this.code(error) === 'P2034')
      throw new ConflictException(
        'Alteração concorrente. Consulte os dados e tente novamente.',
      );
    throw new ServiceUnavailableException(
      'Produtos temporariamente indisponíveis.',
    );
  }
}
