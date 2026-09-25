import 'dotenv/config';
import { PrismaService } from '../database/prisma.service.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--email' || !args[1].trim()) {
    console.error('Uso: npm run admin:promote -- --email usuario@exemplo.com');
    process.exitCode = 1;
    return;
  }
  const email = args[1].trim().toLowerCase();
  const prisma = new PrismaService();
  try {
    // This trusted local command changes only an existing user's role; it never creates credentials.
    const result = await prisma.user.updateMany({
      where: { email },
      data: { role: 'ADMIN' },
    });
    if (result.count !== 1) {
      console.error(
        'Usuário não encontrado. Cadastre a conta antes de promovê-la.',
      );
      process.exitCode = 1;
      return;
    }
    console.log('Usuário promovido a ADMIN.');
  } catch {
    console.error(
      'Não foi possível promover o usuário. Verifique a conexão com o banco.',
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
