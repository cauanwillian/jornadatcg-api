import { BadRequestException, Injectable, ParseUUIDPipe } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

export interface ListCardsDto {
  name?: string;
  setId?: string;
  page: number;
  limit: number;
}

@Injectable()
export class ListCardsQueryPipe implements PipeTransform<
  unknown,
  Promise<ListCardsDto>
> {
  async transform(value: unknown): Promise<ListCardsDto> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Parâmetros de consulta inválidos.');
    }
    const query = value as Record<string, unknown>;
    if (
      Object.keys(query).some(
        (key) => !['name', 'setId', 'page', 'limit'].includes(key),
      )
    ) {
      throw new BadRequestException(
        'Parâmetros aceitos: name, setId, page e limit.',
      );
    }
    let name: string | undefined;
    if (query.name !== undefined) {
      if (
        typeof query.name !== 'string' ||
        !query.name.trim() ||
        query.name.length > 200
      ) {
        throw new BadRequestException(
          'name deve ser um texto não vazio com até 200 caracteres.',
        );
      }
      name = query.name.trim();
    }
    let setId: string | undefined;
    if (query.setId !== undefined) {
      if (typeof query.setId !== 'string')
        throw new BadRequestException('setId deve ser um UUID.');
      await new ParseUUIDPipe().transform(query.setId, {
        type: 'query',
        data: 'setId',
      });
      setId = query.setId;
    }
    return {
      name,
      setId,
      page: this.integer(query.page, 'page', 1, 10_000),
      limit: this.integer(query.limit, 'limit', 20, 100),
    };
  }

  private integer(
    value: unknown,
    field: string,
    fallback: number,
    max: number,
  ): number {
    if (value === undefined) return fallback;
    if (
      typeof value !== 'string' ||
      !/^[1-9]\d*$/.test(value) ||
      Number(value) > max
    ) {
      throw new BadRequestException(
        `${field} deve ser um inteiro entre 1 e ${max}.`,
      );
    }
    return Number(value);
  }
}
