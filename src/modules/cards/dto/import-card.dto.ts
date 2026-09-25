import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

export interface ImportCardDto {
  externalId: string;
}

@Injectable()
export class ImportCardBodyPipe implements PipeTransform<
  unknown,
  ImportCardDto
> {
  transform(value: unknown): ImportCardDto {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Informe um objeto com externalId.');
    }
    const body = value as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => key !== 'externalId') ||
      typeof body.externalId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(body.externalId)
    ) {
      throw new BadRequestException(
        'Envie somente externalId, com até 100 letras, números, hífens ou sublinhados.',
      );
    }
    return { externalId: body.externalId };
  }
}
