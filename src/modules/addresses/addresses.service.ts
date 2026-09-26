import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { addressSelect, toAddressDto } from './dto/address.dto.js';
import type { AddressInput } from './dto/address.dto.js';

@Injectable()
export class AddressesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.transaction(async (tx) =>
      (
        await tx.address.findMany({
          where: { userId },
          select: addressSelect,
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        })
      ).map(toAddressDto),
    );
  }
  get(userId: string, id: string) {
    return this.transaction(async (tx) =>
      toAddressDto(await this.owned(tx, userId, id)),
    );
  }
  create(userId: string, body: AddressInput) {
    return this.transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      if (count >= 20)
        throw new ConflictException('Limite de 20 endereços por conta.');
      const isDefault = count === 0 || body.isDefault === true;
      if (isDefault)
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      return toAddressDto(
        await tx.address.create({
          data: { ...body, userId, isDefault },
          select: addressSelect,
        }),
      );
    });
  }
  replace(userId: string, id: string, body: AddressInput) {
    return this.transaction(async (tx) => {
      const current = await this.owned(tx, userId, id);
      if (current.isDefault && body.isDefault === false)
        throw new ConflictException(
          'Defina outro endereço como principal antes de desmarcar este.',
        );
      if (body.isDefault === true)
        await tx.address.updateMany({
          where: { userId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      return toAddressDto(
        await tx.address.update({
          where: { id, userId },
          data: { ...body, isDefault: body.isDefault ?? current.isDefault },
          select: addressSelect,
        }),
      );
    });
  }
  remove(userId: string, id: string) {
    return this.transaction(async (tx) => {
      const current = await this.owned(tx, userId, id);
      await tx.address.delete({ where: { id, userId } });
      if (current.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (next)
          await tx.address.update({
            where: { id: next.id, userId },
            data: { isDefault: true },
          });
      }
    });
  }
  private async owned(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ) {
    const address = await tx.address.findFirst({
      where: { id, userId },
      select: addressSelect,
    });
    if (!address) throw new NotFoundException('Endereço não encontrado.');
    return address;
  }
  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: 'Serializable',
          maxWait: 5000,
          timeout: 10000,
        });
      } catch (error) {
        if (error instanceof HttpException) throw error;
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        if (code === 'P2034' && attempt < 2) continue;
        if (['P2034', 'P2025', 'P2003'].includes(String(code)))
          throw new ConflictException(
            'Endereços alterados. Consulte os dados e tente novamente.',
          );
        throw new ServiceUnavailableException(
          'Endereços temporariamente indisponíveis.',
        );
      }
    }
  }
}
