import 'dotenv/config';
import { emitKeypressEvents } from 'node:readline';
import type { Key } from 'node:readline';
import { PrismaService } from '../database/prisma.service.js';
import { PasswordService } from '../modules/auth/password.service.js';
import { ForgotPasswordBodyPipe } from '../modules/auth/dto/password-recovery.dto.js';
import {
  LocalRecoveryError,
  resetAdminPassword,
} from './reset-admin-password-operation.js';

function hidden(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || !process.stdout.isTTY)
    throw new LocalRecoveryError(
      'Use um terminal interativo; senhas por argumentos ou pipes não são aceitas.',
    );
  return new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = Boolean(input.isRaw);
    const finish = (error?: Error) => {
      input.removeListener('keypress', onKey);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      input.setRawMode(wasRaw);
      input.pause();
      process.stdout.write('\n');
      if (error) {
        value = '';
        reject(error);
      } else {
        const result = value;
        value = '';
        resolve(result);
      }
    };
    const onEnd = () => finish(new LocalRecoveryError('Operação cancelada.'));
    const onError = () =>
      finish(new LocalRecoveryError('Não foi possível ler a senha.'));
    const onKey = (text: string | undefined, key: Key) => {
      if (key.ctrl && ['c', 'd'].includes(key.name ?? '')) return onEnd();
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') {
        value = Array.from(value).slice(0, -1).join('');
        return;
      }
      if (
        text &&
        !key.ctrl &&
        !key.meta &&
        !Array.from(text).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      ) {
        if (value.length + text.length > 128)
          return finish(
            new LocalRecoveryError(
              'A senha deve ter entre 12 e 128 caracteres.',
            ),
          );
        value += text;
      }
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.once('error', onError);
    process.stdout.write(prompt);
    input.resume();
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--email') {
    console.error(
      'Uso: npm run admin:reset-password -- --email usuario@exemplo.com',
    );
    process.exitCode = 1;
    return;
  }
  let db: PrismaService | undefined;
  let password = '';
  let confirmation = '';
  try {
    if (process.env.NODE_ENV === 'production')
      throw new LocalRecoveryError(
        'Este comando local não está disponível em produção.',
      );
    const { email } = new ForgotPasswordBodyPipe().transform({
      email: args[1],
    });
    console.log(
      'Recuperação local da conta administrativa indicada. A nova senha não aparecerá na tela.',
    );
    password = await hidden('Nova senha (12 a 128 caracteres): ');
    confirmation = await hidden('Confirme a nova senha: ');
    if (password !== confirmation)
      throw new LocalRecoveryError(
        'As senhas não coincidem. Nenhuma alteração realizada.',
      );
    db = new PrismaService();
    await resetAdminPassword(db, new PasswordService(), email, password);
    console.log(
      'Senha atualizada. Sessões e links de recuperação anteriores foram invalidados. Entre no site com a nova senha.',
    );
  } catch (error) {
    // Only local validation text may be displayed; database/driver errors are sanitized below.
    console.error(
      error instanceof LocalRecoveryError
        ? error.message
        : 'Não foi possível redefinir a senha. Confira os dados e a conexão com o banco.',
    );
    process.exitCode = 1;
  } finally {
    password = '';
    confirmation = '';
    await db?.$disconnect().catch(() => {});
  }
}
void main();
