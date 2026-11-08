import { PasswordResetEmailService } from '../modules/auth/password-reset-email.service.js';

export async function runEmailCheck(
  args: string[],
  mail = new PasswordResetEmailService(),
  output: Pick<Console, 'log' | 'error'> = console,
): Promise<number> {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--config-only')) {
    output.error('Uso: npm run email:check -- [--config-only]');
    return 1;
  }
  try {
    mail.assertConfigured();
  } catch {
    output.error(
      'Configuração de e-mail inválida. Confira SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM e PASSWORD_RESET_URL no .env.',
    );
    return 1;
  }
  if (args[0] === '--config-only') {
    output.log(
      'Configuração de e-mail válida. Conexão e entrega ainda não verificadas.',
    );
    return 0;
  }
  try {
    await mail.verifyConnection();
    output.log(
      'Conexão TLS e autenticação SMTP verificadas. Nenhum e-mail enviado. A entrega e o remetente ainda precisam ser testados pelo fluxo de recuperação.',
    );
    return 0;
  } catch {
    output.error(
      'Falha na verificação SMTP. Confira host, porta, credenciais e acesso à rede. Nenhum e-mail enviado.',
    );
    return 1;
  }
}
