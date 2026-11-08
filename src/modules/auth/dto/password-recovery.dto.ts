import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

export interface ForgotPasswordDto {
  email: string;
}
export interface ResetPasswordDto {
  token: string;
  password: string;
}

function body(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new BadRequestException('Dados de recuperação inválidos.');
  return value as Record<string, unknown>;
}

@Injectable()
export class ForgotPasswordBodyPipe implements PipeTransform<
  unknown,
  ForgotPasswordDto
> {
  transform(value: unknown): ForgotPasswordDto {
    const input = body(value, ['email']);
    if (
      typeof input.email !== 'string' ||
      input.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())
    )
      throw new BadRequestException(
        'Informe um email válido com até 254 caracteres.',
      );
    return { email: input.email.trim().toLowerCase() };
  }
}

@Injectable()
export class ResetPasswordBodyPipe implements PipeTransform<
  unknown,
  ResetPasswordDto
> {
  transform(value: unknown): ResetPasswordDto {
    const input = body(value, ['token', 'password']);
    if (
      typeof input.token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.token)
    )
      throw new BadRequestException(
        'Link de recuperação inválido ou expirado. Solicite um novo link.',
      );
    if (
      typeof input.password !== 'string' ||
      input.password.length < 12 ||
      input.password.length > 128 ||
      !input.password.trim()
    )
      throw new BadRequestException(
        'A senha deve ter entre 12 e 128 caracteres.',
      );
    return { token: input.token, password: input.password };
  }
}
