import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

export const notificationKinds = [
  'ORDER_CANCELLED',
  'ORDER_CREATED',
  'ORDER_PAID',
  'SHIPMENT_CREATED',
  'SHIPMENT_DELIVERED',
  'SHIPMENT_FREIGHT_PAID',
  'SHIPMENT_PACKED',
  'SHIPMENT_SHIPPED',
] as const;

export type NotificationKind = (typeof notificationKinds)[number];
export interface NotificationCursor {
  date: string;
  kind: NotificationKind;
  entityId: string;
}
export interface NotificationsQuery {
  limit: number;
  cursor?: NotificationCursor;
}

const invalid = () =>
  new BadRequestException('Parâmetros de atualizações inválidos.');
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify({ v: 1, ...cursor })).toString('base64url');
}

function decodeCursor(value: unknown): NotificationCursor {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 512 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    throw invalid();
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw invalid();
    const decoded: unknown = JSON.parse(bytes.toString('utf8'));
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
      throw invalid();
    const fields = decoded as Record<string, unknown>;
    if (
      Object.keys(fields).sort().join(',') !== 'date,entityId,kind,v' ||
      fields.v !== 1 ||
      typeof fields.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(fields.date) ||
      !Number.isFinite(new Date(fields.date).getTime()) ||
      new Date(fields.date).toISOString() !== fields.date ||
      typeof fields.entityId !== 'string' ||
      !uuid.test(fields.entityId) ||
      !notificationKinds.includes(fields.kind as NotificationKind)
    )
      throw invalid();
    return {
      date: fields.date,
      kind: fields.kind as NotificationKind,
      entityId: fields.entityId,
    };
  } catch {
    throw invalid();
  }
}

@Injectable()
export class NotificationsQueryPipe implements PipeTransform<
  unknown,
  NotificationsQuery
> {
  transform(value: unknown): NotificationsQuery {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !['limit', 'cursor'].includes(key))
    )
      throw invalid();
    const query = value as Record<string, unknown>;
    if (
      query.limit !== undefined &&
      (typeof query.limit !== 'string' ||
        !/^[1-9]\d*$/.test(query.limit) ||
        Number(query.limit) > 50)
    )
      throw invalid();
    return {
      limit: query.limit === undefined ? 20 : Number(query.limit),
      ...(query.cursor === undefined
        ? {}
        : { cursor: decodeCursor(query.cursor) }),
    };
  }
}
