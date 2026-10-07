import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
export const refreshCookie = 'jornada_refresh';
export function checkSessionOrigin(req: Request, requireHeader = false) {
  const origin = req.headers.origin;
  const allowed = (process.env.AUTH_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (
    (origin && !allowed.includes(origin)) ||
    req.headers['sec-fetch-site'] === 'cross-site' ||
    (requireHeader && req.headers['x-requested-with'] !== 'JornadaTCG')
  ) {
    throw new ForbiddenException('Origem da sessão não permitida.');
  }
}
export function readRefreshCookie(req: Request): string | undefined {
  const values = (req.headers.cookie ?? '')
    .split(';')
    .map((x) => x.trim())
    .filter((x) => x.startsWith(`${refreshCookie}=`));
  if (values.length !== 1) return undefined;
  return values[0].slice(refreshCookie.length + 1);
}
export function setRefreshCookie(res: Response, token: string, maxAge: number) {
  res.cookie(refreshCookie, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/auth',
    maxAge,
  });
}
