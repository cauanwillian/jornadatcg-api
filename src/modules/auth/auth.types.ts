import type { Prisma } from '../../generated/prisma/client.js';
import type { Request } from 'express';

export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
} satisfies Prisma.UserSelect;
export type PublicUser = Prisma.UserGetPayload<{
  select: typeof publicUserSelect;
}>;
export type AuthenticatedRequest = Request & { user: PublicUser };
