import { BadRequestException } from '@nestjs/common';
export function bannerInput(value: unknown, partial = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Dados do banner inválidos.');
  const b = value as Record<string, unknown>;
  if (
    Object.keys(b).some(
      (k) => !['title', 'link', 'active', 'sortOrder'].includes(k),
    ) ||
    (!partial && b.title === undefined) ||
    !Object.keys(b).length
  )
    throw new BadRequestException('Informe title, link, active ou sortOrder.');
  const result: {
    title?: string;
    link?: string | null;
    active?: boolean;
    sortOrder?: number;
  } = {};
  if (b.title !== undefined) {
    if (
      typeof b.title !== 'string' ||
      !b.title.trim() ||
      b.title.trim().length > 120
    )
      throw new BadRequestException('Título inválido.');
    result.title = b.title.trim();
  }
  if (b.link !== undefined) {
    if (b.link === null || b.link === '') result.link = null;
    else {
      if (
        typeof b.link !== 'string' ||
        b.link.length > 500 ||
        !/^\/(?!\/)/.test(b.link) ||
        /[\\\s%]/.test(b.link) ||
        b.link.split('').some((char) => char.charCodeAt(0) < 32)
      )
        throw new BadRequestException(
          'link deve ser um caminho interno, como /catalogo.',
        );
      result.link = b.link;
    }
  }
  if (b.active !== undefined) {
    if (![true, false, 'true', 'false'].includes(b.active as boolean))
      throw new BadRequestException('active inválido.');
    result.active = b.active === true || b.active === 'true';
  }
  if (b.sortOrder !== undefined) {
    if (
      (typeof b.sortOrder !== 'number' && typeof b.sortOrder !== 'string') ||
      !/^(0|[1-9]\d{0,5})$/.test(String(b.sortOrder))
    )
      throw new BadRequestException(
        'sortOrder deve ser inteiro de 0 a 999999.',
      );
    result.sortOrder = Number(b.sortOrder);
  }
  return result;
}
