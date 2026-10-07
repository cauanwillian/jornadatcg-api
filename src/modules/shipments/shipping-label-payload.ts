import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { isRecord } from '../payments/integrations/asaas.service.js';
import { AddressBodyPipe } from '../addresses/dto/address.dto.js';
import type { CreateLabelInput } from './dto/shipping-label.dto.js';

export const labelShipmentInclude = {
  selectedQuote: true,
  label: true,
  user: { select: { email: true } },
  payments: true,
  items: {
    include: {
      orderItem: { include: { order: { include: { payments: true } } } },
    },
  },
} satisfies Prisma.ShipmentInclude;
export type LabelShipment = Prisma.ShipmentGetPayload<{
  include: typeof labelShipmentInclude;
}>;

export function assertShipmentPaid(row: LabelShipment) {
  if (
    !row.shippingPaidAt ||
    !row.payments.some(
      (p) => p.status === 'PAID' && p.amount.equals(row.shippingCost),
    ) ||
    row.payments.some((p) => p.status === 'REFUNDED') ||
    !row.items.length ||
    row.items.some(
      (item) =>
        item.orderItem.order.userId !== row.userId ||
        !item.orderItem.order.paidAt ||
        ['PENDING_PAYMENT', 'CANCELLED'].includes(
          item.orderItem.order.status,
        ) ||
        !item.orderItem.order.payments.some((p) => p.status === 'PAID') ||
        item.orderItem.order.payments.some((p) => p.status === 'REFUNDED'),
    )
  )
    throw new ConflictException(
      'Confirme os pagamentos das compras e do frete antes de preparar o envio.',
    );
}

export function createLabelPayload(
  row: LabelShipment,
  input: CreateLabelInput,
  provider: string,
): Prisma.InputJsonObject {
  const quote = row.selectedQuote;
  if (
    !quote ||
    quote.provider !== provider ||
    row.provider !== provider ||
    !quote.amount.equals(row.shippingCost) ||
    !['1', '2', '3', '4', '17'].includes(quote.serviceCode)
  )
    throw new ConflictException(
      'Emissão disponível para Correios e Jadlog do Melhor Envio, no mesmo ambiente da cotação.',
    );
  const parcel = quote.packageSnapshot;
  if (
    !isRecord(parcel) ||
    !['height', 'width', 'length', 'weight'].every(
      (key) =>
        typeof parcel[key] === 'number' &&
        Number.isFinite(parcel[key]) &&
        (parcel[key] as number) > 0,
    )
  )
    throw new ConflictException('Embalagem da cotação inválida.');
  const get = (key: string, optional = false) => {
    const value = process.env[`SHIPPING_SENDER_${key}`]?.trim() ?? '';
    if ((!optional && !value) || value.length > 200 || /[\r\n]/.test(value))
      throw new ServiceUnavailableException(
        `Configure SHIPPING_SENDER_${key} no servidor.`,
      );
    return value;
  };
  let fromAddress;
  try {
    fromAddress = new AddressBodyPipe().transform({
      recipientName: get('NAME'),
      zipCode: process.env.SHIPPING_ORIGIN_ZIP_CODE ?? '78556858',
      street: get('STREET'),
      number: get('NUMBER'),
      complement: get('COMPLEMENT', true),
      neighborhood: get('NEIGHBORHOOD'),
      city: get('CITY'),
      state: get('STATE'),
    });
  } catch (error) {
    if (error instanceof ServiceUnavailableException) throw error;
    throw new ServiceUnavailableException(
      'Endereço do remetente inválido na configuração.',
    );
  }
  if (parcel.originZipCode !== fromAddress.zipCode)
    throw new ConflictException(
      'Origem atual difere da cotação paga. Revise o envio.',
    );
  const document = get('DOCUMENT');
  const phone = get('PHONE');
  const email = get('EMAIL');
  const stateRegister = get('STATE_REGISTER', true);
  if (
    !/^(\d{11}|\d{14})$/.test(document) ||
    !/^\d{10,11}$/.test(phone) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw new ServiceUnavailableException(
      'Documento, telefone ou e-mail do remetente inválido.',
    );
  if (provider.endsWith(':production') && (!input.invoiceKey || !stateRegister))
    throw new ConflictException(
      'Emissão comercial em produção exige chave da nota fiscal e inscrição estadual do remetente.',
    );
  const address = row.addressSnapshot;
  if (
    !isRecord(address) ||
    ![
      'recipientName',
      'zipCode',
      'street',
      'number',
      'neighborhood',
      'city',
      'state',
    ].every((key) => typeof address[key] === 'string' && address[key]) ||
    address.zipCode !== parcel.destinationZipCode
  )
    throw new ConflictException(
      'Endereço de destino inválido ou divergente da cotação.',
    );
  const declared = row.items.reduce(
    (sum, item) => sum.add(item.orderItem.unitPrice.mul(item.quantity)),
    new Prisma.Decimal(0),
  );
  return {
    service: Number(quote.serviceCode),
    from: {
      name: fromAddress.recipientName,
      phone,
      email,
      ...(document.length === 11
        ? { document }
        : { company_document: document }),
      state_register: input.invoiceKey ? stateRegister : 'ISENTO',
      postal_code: fromAddress.zipCode,
      address: fromAddress.street,
      number: fromAddress.number,
      complement: fromAddress.complement ?? '',
      district: fromAddress.neighborhood,
      city: fromAddress.city,
      state_abbr: fromAddress.state,
      country_id: 'BR',
    },
    to: {
      name: address.recipientName as string,
      phone: input.recipientPhone,
      email: row.user.email,
      document: input.recipientDocument,
      postal_code: address.zipCode as string,
      address: address.street as string,
      number: address.number as string,
      complement:
        typeof address.complement === 'string' ? address.complement : '',
      district: address.neighborhood as string,
      city: address.city as string,
      state_abbr: address.state as string,
      country_id: 'BR',
    },
    products: row.items.map((item) => ({
      name: item.orderItem.cardName,
      quantity: item.quantity,
      unitary_value: Number(item.orderItem.unitPrice.toFixed(2)),
    })),
    volumes: [
      {
        height: parcel.height as number,
        width: parcel.width as number,
        length: parcel.length as number,
        weight: parcel.weight as number,
      },
    ],
    options: {
      platform: 'JornadaTCG',
      insurance_value: Number(declared.toFixed(2)),
      receipt: false,
      own_hand: false,
      reverse: false,
      non_commercial: !input.invoiceKey,
      ...(input.invoiceKey ? { invoice: { key: input.invoiceKey } } : {}),
      tags: [{ tag: row.id, url: null }],
    },
  };
}
