import { BadRequestException, Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

export interface LoginDto {
  email: string;
  password: string;
}
export interface RegisterDto extends LoginDto {
  name: string;
}

function readBody(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    throw new BadRequestException(`Envie somente: ${keys.join(', ')}.`);
  }
  return value as Record<string, unknown>;
}

function credentials(
  body: Record<string, unknown>,
  minPasswordLength: number,
): LoginDto {
  if (
    typeof body.email !== 'string' ||
    body.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
  ) {
    throw new BadRequestException(
      'Informe um email válido com até 254 caracteres.',
    );
  }
  if (
    typeof body.password !== 'string' ||
    body.password.length < minPasswordLength ||
    body.password.length > 128 ||
    !body.password.trim()
  ) {
    throw new BadRequestException(
      `A senha deve ter entre ${minPasswordLength} e 128 caracteres.`,
    );
  }
  return { email: body.email.trim().toLowerCase(), password: body.password };
}

@Injectable()
export class LoginBodyPipe implements PipeTransform<unknown, LoginDto> {
  transform(value: unknown): LoginDto {
    return credentials(readBody(value, ['email', 'password']), 1);
  }
}

@Injectable()
export class RegisterBodyPipe implements PipeTransform<unknown, RegisterDto> {
  transform(value: unknown): RegisterDto {
    const body = readBody(value, ['name', 'email', 'password']);
    const login = credentials(body, 12);
    if (
      typeof body.name !== 'string' ||
      !body.name.trim() ||
      body.name.length > 120
    ) {
      throw new BadRequestException(
        'Informe um nome não vazio com até 120 caracteres.',
      );
    }
    return { ...login, name: body.name.trim() };
  }
}
