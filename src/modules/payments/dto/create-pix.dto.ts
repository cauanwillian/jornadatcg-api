import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

export interface CreatePixDto {
  cpf: string;
}

@Injectable()
export class CreatePixPipe implements PipeTransform<unknown, CreatePixDto> {
  transform(value: unknown): CreatePixDto {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== 'cpf')
    ) {
      throw new BadRequestException('Envie somente cpf.');
    }
    const cpf = (value as Record<string, unknown>).cpf;
    if (
      typeof cpf !== 'string' ||
      !/^\d{11}$/.test(cpf) ||
      /^(\d)\1{10}$/.test(cpf)
    )
      throw new BadRequestException('Informe um CPF válido com 11 dígitos.');
    for (const length of [9, 10]) {
      let sum = 0;
      for (let index = 0; index < length; index++)
        sum += Number(cpf[index]) * (length + 1 - index);
      const remainder = (sum * 10) % 11;
      if (Number(cpf[length]) !== (remainder === 10 ? 0 : remainder))
        throw new BadRequestException('Informe um CPF válido com 11 dígitos.');
    }
    return { cpf };
  }
}
