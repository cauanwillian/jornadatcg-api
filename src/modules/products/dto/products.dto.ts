import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

export const MAX_QUANTITY = 2_147_483_647;
export interface CreateProductDto {
  cardId: string;
  conditionId: string;
  languageId: string;
  categoryId: string;
  price: string;
  observation?: string | null;
  active?: boolean;
  availableQuantity: number;
}
export type UpdateProductDto = Partial<
  Omit<CreateProductDto, 'availableQuantity'>
>;
export interface InventoryDto {
  availableQuantity: number;
  expectedAvailableQuantity: number;
}
export interface ListProductsDto {
  page: number;
  limit: number;
  name?: string;
  cardId?: string;
  active?: boolean;
}
export interface ReferenceDto {
  name: string;
  slug?: string;
  code?: string;
  description?: string | null;
}
export type ReferenceKind = 'category' | 'condition' | 'language';

function invalid(message: string): never {
  throw new BadRequestException(message);
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    invalid(`Campos permitidos: ${keys.join(', ')}.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    invalid(`${field} deve ser um texto não vazio de até ${max} caracteres.`);
  return value.trim();
}
function uuid(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    invalid(`${field} deve ser um UUID válido.`);
  return value;
}
function quantity(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_QUANTITY
  )
    invalid(`${field} deve ser um inteiro entre 0 e ${MAX_QUANTITY}.`);
  return value;
}
function product(
  value: unknown,
  partial: boolean,
): UpdateProductDto & { availableQuantity?: number } {
  const keys = [
    'cardId',
    'conditionId',
    'languageId',
    'categoryId',
    'price',
    'observation',
    'active',
  ];
  const body = object(value, partial ? keys : [...keys, 'availableQuantity']);
  if (partial && Object.keys(body).length === 0)
    invalid('Informe ao menos um campo para atualizar.');
  const result: UpdateProductDto & { availableQuantity?: number } = {};
  for (const key of [
    'cardId',
    'conditionId',
    'languageId',
    'categoryId',
  ] as const) {
    if (!partial || body[key] !== undefined) result[key] = uuid(body[key], key);
  }
  if (!partial || body.price !== undefined) {
    if (
      typeof body.price !== 'string' ||
      !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(body.price) ||
      !/[1-9]/.test(body.price)
    )
      invalid(
        'price deve ser um texto decimal positivo de até 10 dígitos inteiros e 2 casas decimais, por exemplo "25.90".',
      );
    result.price = body.price;
  }
  if (body.observation !== undefined) {
    if (
      body.observation !== null &&
      (typeof body.observation !== 'string' || body.observation.length > 2000)
    )
      invalid('observation deve ser texto de até 2000 caracteres ou null.');
    result.observation =
      typeof body.observation === 'string'
        ? body.observation.trim() || null
        : null;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') invalid('active deve ser booleano.');
    result.active = body.active;
  }
  if (!partial)
    result.availableQuantity = quantity(
      body.availableQuantity === undefined ? 0 : body.availableQuantity,
      'availableQuantity',
    );
  return result;
}

@Injectable()
export class CreateProductPipe implements PipeTransform<
  unknown,
  CreateProductDto
> {
  transform(value: unknown): CreateProductDto {
    return product(value, false) as CreateProductDto;
  }
}
@Injectable()
export class UpdateProductPipe implements PipeTransform<
  unknown,
  UpdateProductDto
> {
  transform(value: unknown): UpdateProductDto {
    return product(value, true);
  }
}
@Injectable()
export class InventoryPipe implements PipeTransform<unknown, InventoryDto> {
  transform(value: unknown): InventoryDto {
    const body = object(value, [
      'availableQuantity',
      'expectedAvailableQuantity',
    ]);
    return {
      availableQuantity: quantity(body.availableQuantity, 'availableQuantity'),
      expectedAvailableQuantity: quantity(
        body.expectedAvailableQuantity,
        'expectedAvailableQuantity',
      ),
    };
  }
}
@Injectable()
export class ListProductsPipe implements PipeTransform<
  unknown,
  ListProductsDto
> {
  transform(value: unknown): ListProductsDto {
    const query = object(value, ['name', 'cardId', 'active', 'page', 'limit']);
    const integer = (value: unknown, fallback: number, max: number): number => {
      if (value === undefined) return fallback;
      if (
        typeof value !== 'string' ||
        !/^[1-9]\d*$/.test(value) ||
        Number(value) > max
      )
        invalid(`Paginação deve conter inteiros entre 1 e ${max}.`);
      return Number(value);
    };
    if (
      query.active !== undefined &&
      query.active !== 'true' &&
      query.active !== 'false'
    )
      invalid('active deve ser true ou false.');
    return {
      page: integer(query.page, 1, 10_000),
      limit: integer(query.limit, 20, 100),
      name:
        query.name === undefined ? undefined : text(query.name, 'name', 200),
      cardId:
        query.cardId === undefined ? undefined : uuid(query.cardId, 'cardId'),
      active: query.active === undefined ? undefined : query.active === 'true',
    };
  }
}

export class ReferencePipe implements PipeTransform<unknown, ReferenceDto> {
  constructor(private readonly kind: ReferenceKind) {}
  transform(value: unknown): ReferenceDto {
    const body = object(
      value,
      this.kind === 'category'
        ? ['name', 'slug', 'description']
        : this.kind === 'condition'
          ? ['name', 'code', 'description']
          : ['name', 'code'],
    );
    const result: ReferenceDto = { name: text(body.name, 'name', 120) };
    if (this.kind === 'category') {
      const slug = text(body.slug, 'slug', 100).toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
        invalid(
          'slug deve conter letras minúsculas, números e hífens entre palavras.',
        );
      result.slug = slug;
    } else {
      const code = text(body.code, 'code', 20).toUpperCase();
      if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code))
        invalid('code deve conter letras, números ou hífens entre palavras.');
      result.code = code;
    }
    if (body.description !== undefined)
      result.description =
        body.description === null
          ? null
          : text(body.description, 'description', 2000);
    return result;
  }
}
