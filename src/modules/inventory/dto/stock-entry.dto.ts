import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { Request } from 'express';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () =>
  new BadRequestException(
    'Dados da entrada de estoque inválidos. Confira quantidade e motivo.',
  );

export interface StockEntryDto {
  quantity: number;
  reason: string;
}

@Injectable()
export class StockEntryPipe implements PipeTransform<unknown, StockEntryDto> {
  transform(value: unknown): StockEntryDto {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw invalid();
    const body = value as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => !['quantity', 'reason'].includes(key)) ||
      typeof body.quantity !== 'number' ||
      !Number.isInteger(body.quantity) ||
      body.quantity < 1 ||
      body.quantity > 2_147_483_647 ||
      typeof body.reason !== 'string'
    )
      throw invalid();
    const reason = body.reason.trim();
    if (
      reason.length < 3 ||
      reason.length > 500 ||
      Array.from(body.reason).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw invalid();
    return { quantity: body.quantity, reason };
  }
}

export function stockEntryOperationKey(
  request: Pick<Request, 'headers' | 'rawHeaders'>,
): string {
  const header = request.headers['idempotency-key'];
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === 'idempotency-key') count++;
  }
  if (count !== 1 || typeof header !== 'string' || !uuid.test(header))
    throw new BadRequestException(
      'Informe uma única chave de idempotência UUID válida para a entrada.',
    );
  return header.toLowerCase();
}
