import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { encodeNotificationCursor } from './dto/notifications-query.dto.js';
import type {
  NotificationKind,
  NotificationsQuery,
} from './dto/notifications-query.dto.js';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  occurredAt: string;
  title: string;
  message: string;
  target: { type: 'order' | 'shipment'; id: string };
  orderNumber?: number;
}

const orderSources = [
  { kind: 'ORDER_CREATED', field: 'createdAt' },
  { kind: 'ORDER_PAID', field: 'paidAt' },
  { kind: 'ORDER_CANCELLED', field: 'cancelledAt' },
] as const;
const shipmentSources = [
  { kind: 'SHIPMENT_CREATED', field: 'createdAt' },
  { kind: 'SHIPMENT_FREIGHT_PAID', field: 'shippingPaidAt' },
  { kind: 'SHIPMENT_PACKED', field: 'packedAt' },
  { kind: 'SHIPMENT_SHIPPED', field: 'shippedAt' },
  { kind: 'SHIPMENT_DELIVERED', field: 'deliveredAt' },
] as const;

const descriptions: Record<
  NotificationKind,
  { title: string; message: string }
> = {
  ORDER_CREATED: {
    title: 'Pedido registrado',
    message:
      'Seu pedido foi registrado. Consulte o pedido para acompanhar o pagamento e o estado atual.',
  },
  ORDER_PAID: {
    title: 'Pagamento do pedido confirmado',
    message:
      'O pagamento deste pedido foi confirmado. Consulte suas compras para acompanhar os próximos passos.',
  },
  ORDER_CANCELLED: {
    title: 'Pedido cancelado',
    message:
      'Este pedido foi cancelado. Consulte o detalhe para verificar a situação atual.',
  },
  SHIPMENT_CREATED: {
    title: 'Solicitação de envio registrada',
    message:
      'Sua solicitação de envio foi registrada. Consulte o envio para verificar o frete e as próximas etapas.',
  },
  SHIPMENT_FREIGHT_PAID: {
    title: 'Pagamento do frete confirmado',
    message: 'O pagamento do frete deste envio foi confirmado.',
  },
  SHIPMENT_PACKED: {
    title: 'Embalagem conferida',
    message:
      'As cartas e a embalagem deste envio foram conferidas para preparação da postagem.',
  },
  SHIPMENT_SHIPPED: {
    title: 'Envio postado',
    message:
      'A postagem deste envio foi confirmada. Consulte o envio para acompanhar o rastreamento.',
  },
  SHIPMENT_DELIVERED: {
    title: 'Entrega confirmada',
    message: 'A entrega deste envio foi confirmada pelo serviço de transporte.',
  },
};

// Each source uses the same global key: date descending, kind and UUID ascending.
// The kind is constant within a query, so only its relation to the cursor matters.
function sourceDateFilter(
  field: string,
  kind: NotificationKind,
  query: NotificationsQuery,
) {
  const cursor = query.cursor;
  // createdAt is required in Prisma; a `not: null` filter is only valid for
  // the nullable milestone fields.
  if (!cursor) return field === 'createdAt' ? {} : { [field]: { not: null } };
  const date = new Date(cursor.date);
  if (kind < cursor.kind) return { [field]: { lt: date } };
  if (kind > cursor.kind) return { [field]: { lte: date } };
  return {
    OR: [
      { [field]: { lt: date } },
      { [field]: date, id: { gt: cursor.entityId } },
    ],
  };
}

function item(
  kind: NotificationKind,
  entityId: string,
  date: Date,
  orderNumber?: number,
): NotificationItem {
  const text = descriptions[kind];
  return {
    id: `${kind}:${entityId}`,
    kind,
    occurredAt: date.toISOString(),
    title:
      orderNumber === undefined
        ? text.title
        : kind === 'ORDER_PAID'
          ? `Pagamento do pedido #${orderNumber} confirmado`
          : `Pedido #${orderNumber} ${kind === 'ORDER_CANCELLED' ? 'cancelado' : 'registrado'}`,
    message: text.message,
    target: {
      type: kind.startsWith('ORDER_') ? 'order' : 'shipment',
      id: entityId,
    },
    ...(orderNumber === undefined ? {} : { orderNumber }),
  };
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(userId: string, query: NotificationsQuery) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const events: NotificationItem[] = [];
          for (const { kind, field } of orderSources) {
            const rows = await tx.order.findMany({
              where: {
                userId,
                ...sourceDateFilter(field, kind, query),
              } satisfies Prisma.OrderWhereInput,
              select: {
                id: true,
                orderNumber: true,
                createdAt: field === 'createdAt',
                paidAt: field === 'paidAt',
                cancelledAt: field === 'cancelledAt',
              },
              orderBy: [{ [field]: 'desc' }, { id: 'asc' }],
              take: query.limit + 1,
            });
            for (const row of rows) {
              const date = row[field];
              if (date) events.push(item(kind, row.id, date, row.orderNumber));
            }
          }
          for (const { kind, field } of shipmentSources) {
            const rows = await tx.shipment.findMany({
              where: {
                userId,
                ...sourceDateFilter(field, kind, query),
              } satisfies Prisma.ShipmentWhereInput,
              select: {
                id: true,
                createdAt: field === 'createdAt',
                shippingPaidAt: field === 'shippingPaidAt',
                packedAt: field === 'packedAt',
                shippedAt: field === 'shippedAt',
                deliveredAt: field === 'deliveredAt',
              },
              orderBy: [{ [field]: 'desc' }, { id: 'asc' }],
              take: query.limit + 1,
            });
            for (const row of rows) {
              const date = row[field];
              if (date) events.push(item(kind, row.id, date));
            }
          }
          events.sort(
            (left, right) =>
              right.occurredAt.localeCompare(left.occurredAt) ||
              (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0) ||
              left.target.id.localeCompare(right.target.id),
          );
          const items = events.slice(0, query.limit);
          const hasMore = events.length > query.limit;
          const last = items.at(-1);
          return {
            items,
            nextCursor:
              hasMore && last
                ? encodeNotificationCursor({
                    date: last.occurredAt,
                    kind: last.kind,
                    entityId: last.target.id,
                  })
                : null,
            hasMore,
          };
        },
        { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Atualizações temporariamente indisponíveis.',
      );
    }
  }
}
