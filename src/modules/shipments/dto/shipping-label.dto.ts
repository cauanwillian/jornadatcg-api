import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { CreatePixPipe } from '../../payments/dto/create-pix.dto.js';
import { isRecord } from '../../payments/integrations/asaas.service.js';

export interface CreateLabelInput {
  recipientDocument: string;
  recipientPhone: string;
  invoiceKey?: string;
}
@Injectable()
export class CreateLabelPipe implements PipeTransform {
  transform(value: unknown): CreateLabelInput {
    if (
      !isRecord(value) ||
      Object.keys(value).some(
        (key) =>
          !['recipientDocument', 'recipientPhone', 'invoiceKey'].includes(key),
      )
    )
      throw new BadRequestException(
        'Informe documento e telefone do destinatário e, quando aplicável, a chave da nota fiscal.',
      );
    const document = new CreatePixPipe().transform({
      cpf: value.recipientDocument,
    }).cpf;
    if (
      typeof value.recipientPhone !== 'string' ||
      !/^\d{10,11}$/.test(value.recipientPhone)
    )
      throw new BadRequestException(
        'Telefone do destinatário deve conter 10 ou 11 dígitos.',
      );
    if (
      value.invoiceKey !== undefined &&
      (typeof value.invoiceKey !== 'string' ||
        !/^\d{44}$/.test(value.invoiceKey))
    )
      throw new BadRequestException(
        'A chave da nota fiscal deve conter 44 dígitos.',
      );
    return {
      recipientDocument: document,
      recipientPhone: value.recipientPhone,
      ...(value.invoiceKey === undefined
        ? {}
        : { invoiceKey: value.invoiceKey as string }),
    };
  }
}
@Injectable()
export class LabelCheckoutPipe implements PipeTransform {
  transform(value: unknown): { expectedCost: string } {
    if (
      !isRecord(value) ||
      Object.keys(value).length !== 1 ||
      typeof value.expectedCost !== 'string' ||
      !/^(0|[1-9]\d{0,9})\.\d{2}$/.test(value.expectedCost) ||
      value.expectedCost === '0.00'
    )
      throw new BadRequestException(
        'Informe expectedCost como valor decimal positivo com duas casas.',
      );
    return { expectedCost: value.expectedCost };
  }
}
