import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';

export interface AddressInput {
  label: string | null;
  recipientName: string;
  zipCode: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  isDefault?: boolean;
}
const states = new Set(
  'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(
    ' ',
  ),
);
const fields = [
  'label',
  'recipientName',
  'zipCode',
  'street',
  'number',
  'complement',
  'neighborhood',
  'city',
  'state',
  'isDefault',
];

@Injectable()
export class AddressBodyPipe implements PipeTransform<unknown, AddressInput> {
  transform(value: unknown): AddressInput {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !fields.includes(key))
    )
      throw new BadRequestException('Campos de endereço inválidos.');
    const body = value as Record<string, unknown>;
    const text = (
      key: string,
      max: number,
      optional = false,
    ): string | null => {
      const raw = body[key];
      if (optional && (raw == null || raw === '')) return null;
      if (
        typeof raw !== 'string' ||
        !raw.trim() ||
        raw.trim().length > max ||
        raw.split('').some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || code === 127;
        })
      )
        throw new BadRequestException(
          `${key} deve conter entre 1 e ${max} caracteres.`,
        );
      return raw.trim();
    };
    const zipCode = text('zipCode', 9)!;
    if (!/^\d{5}-?\d{3}$/.test(zipCode))
      throw new BadRequestException(
        'CEP deve conter 8 dígitos, com ou sem hífen.',
      );
    const state = text('state', 2)!.toUpperCase();
    if (!states.has(state))
      throw new BadRequestException('Informe uma UF brasileira válida.');
    if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean')
      throw new BadRequestException('isDefault deve ser booleano.');
    return {
      label: text('label', 60, true),
      recipientName: text('recipientName', 120)!,
      zipCode: zipCode.replace('-', ''),
      street: text('street', 200)!,
      number: text('number', 20)!,
      complement: text('complement', 120, true),
      neighborhood: text('neighborhood', 120)!,
      city: text('city', 120)!,
      state,
      ...(body.isDefault === undefined
        ? {}
        : { isDefault: body.isDefault as boolean }),
    };
  }
}

export const addressSelect = {
  id: true,
  label: true,
  recipientName: true,
  zipCode: true,
  street: true,
  number: true,
  complement: true,
  neighborhood: true,
  city: true,
  state: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AddressSelect;
export type AddressRecord = Prisma.AddressGetPayload<{
  select: typeof addressSelect;
}>;
export const toAddressDto = (address: AddressRecord) => ({
  ...address,
  createdAt: address.createdAt.toISOString(),
  updatedAt: address.updatedAt.toISOString(),
});
