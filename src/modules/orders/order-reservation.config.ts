import { Injectable } from '@nestjs/common';

@Injectable()
export class OrderReservationConfig {
  readonly minutes: number;

  constructor() {
    const value = process.env.ORDER_RESERVATION_MINUTES ?? '30';
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 1440) {
      throw new Error(
        'ORDER_RESERVATION_MINUTES deve ser um inteiro entre 1 e 1440.',
      );
    }
    this.minutes = Number(value);
  }

  deadline(now = new Date()) {
    return new Date(now.getTime() + this.minutes * 60_000);
  }
}
