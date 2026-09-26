import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { OrderStatus } from '../../../generated/prisma/client.js';

export interface CheckoutDto {
  expectedSubtotal: string;
}

@Injectable()
export class CheckoutPipe implements PipeTransform<unknown, CheckoutDto> {
  transform(value: unknown): CheckoutDto {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== 'expectedSubtotal')
    ) {
      throw new BadRequestException('Envie somente expectedSubtotal.');
    }
    const amount = (value as Record<string, unknown>).expectedSubtotal;
    if (
      typeof amount !== 'string' ||
      !/^(0|[1-9]\d{0,9})\.\d{2}$/.test(amount) ||
      amount === '0.00'
    ) {
      throw new BadRequestException(
        'expectedSubtotal deve ser uma string monetária positiva, como "25.90", até 9999999999.99.',
      );
    }
    return { expectedSubtotal: amount };
  }
}

export interface OrderListQuery {
  page: number;
  pageSize: number;
  status?: OrderStatus;
}

@Injectable()
export class OrderListPipe implements PipeTransform<unknown, OrderListQuery> {
  transform(value: unknown): OrderListQuery {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Parâmetros inválidos.');
    }
    const query = value as Record<string, unknown>;
    if (
      Object.keys(query).some(
        (key) => !['page', 'pageSize', 'status'].includes(key),
      )
    ) {
      throw new BadRequestException('Use somente page, pageSize e status.');
    }
    const integer = (key: string, fallback: number, max: number) => {
      const raw = query[key];
      if (raw === undefined) return fallback;
      if (
        typeof raw !== 'string' ||
        !/^[1-9]\d*$/.test(raw) ||
        Number(raw) > max
      ) {
        throw new BadRequestException(
          `${key} deve ser um inteiro entre 1 e ${max}.`,
        );
      }
      return Number(raw);
    };
    const status = query.status;
    if (
      status !== undefined &&
      (typeof status !== 'string' ||
        !Object.values(OrderStatus).includes(status as OrderStatus))
    ) {
      throw new BadRequestException('status inválido.');
    }
    return {
      page: integer('page', 1, 1000000),
      pageSize: integer('pageSize', 20, 100),
      ...(status === undefined ? {} : { status: status as OrderStatus }),
    };
  }
}
