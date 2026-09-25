import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

export interface SearchCardsDto {
  name?: string;
  code?: { number: number; printedTotal: number };
}

@Injectable()
export class SearchCardsQueryPipe implements PipeTransform<
  unknown,
  SearchCardsDto
> {
  transform(value: unknown): SearchCardsDto {
    if (!value || typeof value !== 'object') {
      throw new BadRequestException('Informe name ou code.');
    }
    const query = value as Record<string, unknown>;
    const name = this.readString(query.name, 'name', 200);
    const code = this.readString(query.code, 'code', 33);
    if (!name && !code) {
      throw new BadRequestException('Informe name ou code.');
    }
    if (!code) return { name };
    if (!/^\d+\/\d+$/.test(code)) {
      throw new BadRequestException(
        'code deve seguir o formato número/número, por exemplo 025/182.',
      );
    }
    const [number, printedTotal] = code.split('/').map(Number);
    if (
      !Number.isSafeInteger(number) ||
      !Number.isSafeInteger(printedTotal) ||
      number < 0 ||
      printedTotal <= 0
    ) {
      throw new BadRequestException(
        'code deve conter números inteiros válidos e total maior que zero.',
      );
    }
    return { name, code: { number, printedTotal } };
  }

  private readString(
    value: unknown,
    field: string,
    maxLength: number,
  ): string | undefined {
    if (value === undefined) return undefined;
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > maxLength
    ) {
      throw new BadRequestException(
        `${field} deve ser um texto não vazio com até ${maxLength} caracteres.`,
      );
    }
    return value.trim();
  }
}
