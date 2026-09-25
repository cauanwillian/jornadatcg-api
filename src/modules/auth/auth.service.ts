import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { PasswordService } from './password.service.js';
import { AuthTokenService } from './auth-token.service.js';
import { publicUserSelect } from './auth.types.js';
import type { PublicUser } from './auth.types.js';
import type { LoginDto, RegisterDto } from './dto/auth.dto.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AuthTokenService) private readonly tokens: AuthTokenService,
  ) {}

  async register(input: RegisterDto): Promise<PublicUser> {
    this.tokens.assertConfigured();
    const passwordHash = await this.passwords.hash(input.password);
    try {
      return await this.prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          role: 'CUSTOMER',
        },
        select: publicUserSelect,
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Não foi possível cadastrar este email.');
      }
      this.databaseError(error);
    }
  }

  async login(input: LoginDto): Promise<{
    accessToken: string;
    tokenType: 'Bearer';
    expiresIn: number;
    user: PublicUser;
  }> {
    this.tokens.assertConfigured();
    let user;
    try {
      user = await this.prisma.user.findUnique({
        where: { email: input.email },
        select: { ...publicUserSelect, passwordHash: true },
      });
    } catch (error) {
      this.databaseError(error);
    }
    const valid = await this.passwords.verify(
      input.password,
      user?.passwordHash,
    );
    if (!user || !valid)
      throw new UnauthorizedException('Email ou senha inválidos.');
    return {
      accessToken: await this.tokens.sign(user.id),
      tokenType: 'Bearer',
      expiresIn: this.tokens.expiresIn,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  async currentUser(id: string): Promise<PublicUser> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id },
        select: publicUserSelect,
      });
      if (!user) throw new UnauthorizedException('Usuário não autenticado.');
      return user;
    } catch (error) {
      this.databaseError(error);
    }
  }

  private databaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    throw new ServiceUnavailableException(
      'Autenticação temporariamente indisponível.',
    );
  }
}
