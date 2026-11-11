import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import nodemailer from 'nodemailer';

interface EmailConfiguration {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  resetUrl: string;
}

const configuredError = () =>
  new ServiceUnavailableException(
    'Recuperação de senha por e-mail não configurada.',
  );
const deliveryError = () =>
  new ServiceUnavailableException(
    'Não foi possível enviar o e-mail de recuperação.',
  );
const controls = (value: string) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
const domainLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function hostname(value: string): boolean {
  if (!value || value.length > 253 || controls(value)) return false;
  if (isIP(value)) return true;
  return value.split('.').every((part) => domainLabel.test(part));
}

/** Only one bare mailbox is allowed; names and envelope fields are fixed here. */
function mailbox(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 254 ||
    controls(value) ||
    !/^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/.test(value)
  )
    return false;
  const [local, domain] = value.split('@');
  return Boolean(
    local &&
    domain &&
    !Array.from(domain).some((character) => '/\\:?#%[]'.includes(character)) &&
    local.length <= 64 &&
    !local.startsWith('.') &&
    !local.endsWith('.') &&
    !local.includes('..') &&
    hostname(domainToASCII(domain!)),
  );
}

function canonicalMailbox(value: string): string {
  const [local, domain] = value.split('@');
  return `${local!.toLowerCase()}@${domainToASCII(domain!).toLowerCase()}`;
}

function resetUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw || controls(raw) || raw.includes('?') || raw.includes('#'))
    throw configuredError();
  try {
    const url = new URL(raw);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      )
    )
      throw configuredError();
    return url.href;
  } catch {
    throw configuredError();
  }
}

function configuration(): EmailConfiguration {
  const host = process.env.SMTP_HOST?.trim();
  const rawPort = process.env.SMTP_PORT ?? '587';
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM?.trim();
  if (
    !host ||
    !hostname(host) ||
    !/^[1-9]\d{0,4}$/.test(rawPort) ||
    Number(rawPort) > 65535 ||
    !user ||
    controls(user) ||
    !password?.trim() ||
    controls(password) ||
    !mailbox(from)
  )
    throw configuredError();
  return {
    host,
    port: Number(rawPort),
    user,
    password,
    from,
    resetUrl: resetUrl(process.env.PASSWORD_RESET_URL),
  };
}

function accepted(value: unknown, recipient: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const info = value as Record<string, unknown>;
  return Boolean(
    Array.isArray(info.accepted) &&
    info.accepted.length === 1 &&
    mailbox(info.accepted[0]) &&
    canonicalMailbox(info.accepted[0]) === canonicalMailbox(recipient) &&
    Array.isArray(info.rejected) &&
    info.rejected.length === 0,
  );
}

function createTransport(settings: EmailConfiguration) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.password },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    pool: false,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10_000,
    dnsTimeout: 5000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
}

@Injectable()
export class PasswordResetEmailService {
  assertConfigured(): void {
    configuration();
  }

  /** Local setup check only: authenticates without sending a message. */
  async verifyConnection(): Promise<void> {
    const settings = configuration();
    const failure = () =>
      new ServiceUnavailableException(
        'Não foi possível verificar o SMTP. Confira host, porta, credenciais e acesso à rede.',
      );
    let transport: ReturnType<typeof createTransport> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      transport = createTransport(settings);
      const sender = transport;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(failure()), 15_000);
      });
      const verified = await Promise.race([
        Promise.resolve().then(() => sender.verify()),
        timeout,
      ]);
      if (verified !== true) throw failure();
    } catch {
      throw failure();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      try {
        transport?.close();
      } catch {
        /* Never expose transport errors. */
      }
    }
  }

  async sendReset(to: string, token: string): Promise<void> {
    const settings = configuration();
    if (!mailbox(to) || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw deliveryError();

    let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      transport = createTransport(settings);
      const sender = transport;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(deliveryError()), 15_000);
      });
      const link = `${settings.resetUrl}#reset-password=${token}`;
      const result: unknown = await Promise.race([
        Promise.resolve().then(() =>
          sender.sendMail({
            from: { name: 'HIKARI IMPORTADOS', address: settings.from },
            to: { name: '', address: to },
            envelope: { from: settings.from, to: [to] },
            subject: 'Redefina sua senha na HIKARI IMPORTADOS',
            text: [
              'Recebemos uma solicitação para redefinir sua senha na HIKARI IMPORTADOS.',
              '',
              'Acesse o link abaixo para escolher uma nova senha. Ele é válido por 15 minutos e pode ser usado uma única vez.',
              '',
              link,
              '',
              'Se você não solicitou esta alteração, ignore este e-mail. Sua senha continua a mesma.',
            ].join('\n'),
            disableFileAccess: true,
            disableUrlAccess: true,
          }),
        ),
        timeout,
      ]);
      if (!accepted(result, to)) throw deliveryError();
    } catch {
      throw deliveryError();
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      try {
        transport?.close();
      } catch {
        // Closing must never expose a provider error or replace the result.
      }
    }
  }
}
