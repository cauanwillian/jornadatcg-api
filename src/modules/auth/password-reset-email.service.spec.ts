import { ServiceUnavailableException } from '@nestjs/common';
import { PasswordResetEmailService } from './password-reset-email.service.js';

const smtp = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  verify: vi.fn(),
  close: vi.fn(),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: smtp.createTransport },
}));

const recipient = 'customer@example.com';
const token = 'a'.repeat(43);
const configurationMessage = 'Recuperação de senha por e-mail não configurada.';
const deliveryMessage = 'Não foi possível enviar o e-mail de recuperação.';

function setup() {
  vi.stubEnv('SMTP_HOST', 'smtp.example.com');
  vi.stubEnv('SMTP_PORT', '587');
  vi.stubEnv('SMTP_USER', 'fixture-user');
  vi.stubEnv('SMTP_PASSWORD', 'fixture-password');
  vi.stubEnv('SMTP_FROM', 'loja@example.com');
  vi.stubEnv('PASSWORD_RESET_URL', 'https://shop.example.com/recover');
}

beforeEach(() => {
  vi.resetAllMocks();
  setup();
  smtp.createTransport.mockReturnValue({
    sendMail: smtp.sendMail,
    verify: smtp.verify,
    close: smtp.close,
  });
  smtp.sendMail.mockResolvedValue({ accepted: [recipient], rejected: [] });
  smtp.verify.mockResolvedValue(true);
});

describe('PasswordResetEmailService SMTP setup verification', () => {
  const service = new PasswordResetEmailService();
  const failure = 'Não foi possível verificar o SMTP.';

  it.each(['587', '465'])(
    'checks authentication with TLS on port %s without sending mail',
    async (port) => {
      vi.stubEnv('SMTP_PORT', port);
      await expect(service.verifyConnection()).resolves.toBeUndefined();
      expect(smtp.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          secure: port === '465',
          requireTLS: port !== '465',
          tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
          logger: false,
          debug: false,
        }),
      );
      expect(smtp.verify).toHaveBeenCalledTimes(1);
      expect(smtp.sendMail).not.toHaveBeenCalled();
      expect(smtp.close).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects incomplete configuration without opening a connection', async () => {
    vi.stubEnv('PASSWORD_RESET_URL', '');
    await expect(service.verifyConnection()).rejects.toThrow(
      configurationMessage,
    );
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it.each([false, undefined, 'true'])(
    'requires explicit successful verification: %s',
    async (value) => {
      smtp.verify.mockResolvedValue(value);
      await expect(service.verifyConnection()).rejects.toThrow(failure);
      expect(smtp.close).toHaveBeenCalledTimes(1);
    },
  );

  it('sanitizes authentication errors and closes the connection', async () => {
    smtp.verify.mockRejectedValue(
      new Error('private fixture-password customer@example.com'),
    );
    try {
      await service.verifyConnection();
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(JSON.stringify(error)).not.toContain('fixture-password');
      expect(JSON.stringify(error)).not.toContain(recipient);
    }
    expect(smtp.sendMail).not.toHaveBeenCalled();
    expect(smtp.close).toHaveBeenCalledTimes(1);
  });

  it('sanitizes initialization failure', async () => {
    smtp.createTransport.mockImplementation(() => {
      throw new Error('secret');
    });
    await expect(service.verifyConnection()).rejects.toThrow(failure);
  });

  it('bounds stalled verification and consumes a late rejection', async () => {
    vi.useFakeTimers();
    let reject!: (error: Error) => void;
    smtp.verify.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const result = expect(service.verifyConnection()).rejects.toThrow(failure);
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    reject(new Error('late secret'));
    await Promise.resolve();
    expect(smtp.close).toHaveBeenCalledTimes(1);
    expect(smtp.verify).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps successful verification when closing throws', async () => {
    smtp.close.mockImplementation(() => {
      throw new Error('secret');
    });
    await expect(service.verifyConnection()).resolves.toBeUndefined();
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('PasswordResetEmailService configuration', () => {
  const service = new PasswordResetEmailService();

  it('checks configuration without connecting or sending', () => {
    expect(() => service.assertConfigured()).not.toThrow();
    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it.each([
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASSWORD',
    'SMTP_FROM',
    'PASSWORD_RESET_URL',
  ])('rejects an absent %s without exposing its value', (key) => {
    vi.stubEnv(key, '');
    expect(() => service.assertConfigured()).toThrow(configurationMessage);
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it.each([
    'smtp://smtp.example.com',
    'smtp.example.com/path',
    'smtp.example.com:587',
    'smtp.example.com\r\nInjected: true',
    'smtp example.com',
    'smtp..example.com',
    '-smtp.example.com',
  ])('rejects a malformed host %s', (host) => {
    vi.stubEnv('SMTP_HOST', host);
    expect(() => service.assertConfigured()).toThrow(configurationMessage);
  });

  it.each(['0', '65536', '-1', '25.5', ' 587 ', '587suffix', '00587', ''])(
    'rejects an invalid explicit port %s',
    (port) => {
      vi.stubEnv('SMTP_PORT', port);
      expect(() => service.assertConfigured()).toThrow(configurationMessage);
    },
  );

  it.each([
    'Loja <loja@example.com>',
    'loja@example.com,attacker@example.com',
    'loja@example.com\r\nBcc: attacker@example.com',
    'loja@invalid',
    'loja@bad/domain.example',
    'loja..tcg@example.com',
  ])('requires a single bare sender mailbox %s', (from) => {
    vi.stubEnv('SMTP_FROM', from);
    expect(() => service.assertConfigured()).toThrow(configurationMessage);
  });

  it.each([
    'http://shop.example.com/reset',
    'https://user:private@shop.example.com/reset',
    'https://shop.example.com/reset?redirect=other',
    'https://shop.example.com/reset?',
    'https://shop.example.com/reset#fragment',
    'https://shop.example.com/reset#',
    'http://localhost.attacker.example/reset',
    'javascript:alert(1)',
    '//shop.example.com/reset',
  ])('rejects an insecure or non-fixed reset URL %s', (url) => {
    vi.stubEnv('PASSWORD_RESET_URL', url);
    expect(() => service.assertConfigured()).toThrow(configurationMessage);
  });

  it.each([
    'http://localhost:5173/',
    'http://127.0.0.1:5173/recover',
    'http://[::1]:5173/recover',
    'https://shop.example.com/reset',
  ])('accepts the configured frontend URL %s', (url) => {
    vi.stubEnv('PASSWORD_RESET_URL', url);
    expect(() => service.assertConfigured()).not.toThrow();
  });

  it.each(['SMTP_USER', 'SMTP_PASSWORD'])('rejects controls in %s', (key) => {
    vi.stubEnv(key, 'credential\r\nprivate');
    expect(() => service.assertConfigured()).toThrow(configurationMessage);
  });
});

describe('PasswordResetEmailService delivery', () => {
  const service = new PasswordResetEmailService();

  it('uses mandatory STARTTLS and disables content fetching and protocol logs', async () => {
    await expect(service.sendReset(recipient, token)).resolves.toBeUndefined();
    expect(smtp.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'fixture-user', pass: 'fixture-password' },
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
    expect(smtp.close).toHaveBeenCalledTimes(1);
  });

  it('uses TLS immediately on port 465', async () => {
    vi.stubEnv('SMTP_PORT', '465');
    await service.sendReset(recipient, token);
    expect(smtp.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true, requireTLS: false }),
    );
  });

  it('defaults to port 587 and preserves the SMTP password exactly', async () => {
    vi.stubEnv('SMTP_PORT', undefined);
    vi.stubEnv('SMTP_PASSWORD', ' fixture-password ');
    await service.sendReset(recipient, token);
    expect(smtp.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 587,
        auth: { user: 'fixture-user', pass: ' fixture-password ' },
      }),
    );
  });

  it('sends only the fixed sender, selected recipient and single-use frontend link', async () => {
    await service.sendReset(recipient, token);
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    const message = smtp.sendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(message).toEqual({
      from: { name: 'HIKARI IMPORTADOS', address: 'loja@example.com' },
      to: { name: '', address: recipient },
      envelope: { from: 'loja@example.com', to: [recipient] },
      subject: 'Redefina sua senha na HIKARI IMPORTADOS',
      text: expect.stringContaining(
        `https://shop.example.com/recover#reset-password=${token}`,
      ),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    expect(message.text).toContain('15 minutos');
    expect(message.text).toContain('uma única vez');
    expect(message.text).toContain('Sua senha continua a mesma.');
    expect(message).not.toHaveProperty('html');
    expect(message).not.toHaveProperty('attachments');
    expect(message.text).not.toContain('fixture-password');
  });

  it('accepts case-insensitive envelope acknowledgement', async () => {
    smtp.sendMail.mockResolvedValue({
      accepted: ['CUSTOMER@EXAMPLE.COM'],
      rejected: [],
    });
    await expect(service.sendReset(recipient, token)).resolves.toBeUndefined();
  });

  it.each([
    'customer@example.com,other@example.com',
    'Customer <customer@example.com>',
    'customer@example.com\r\nBcc: other@example.com',
    'customer@localhost',
    'customer@bad/domain.example',
    '',
  ])('rejects a malformed recipient before opening SMTP: %s', async (to) => {
    await expect(service.sendReset(to, token)).rejects.toThrow(deliveryMessage);
    expect(smtp.createTransport).not.toHaveBeenCalled();
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it.each([
    '',
    'a'.repeat(42),
    'a'.repeat(44),
    `${'a'.repeat(42)}=`,
    `${'a'.repeat(42)}\n`,
  ])(
    'rejects a malformed reset token before opening SMTP',
    async (badToken) => {
      await expect(service.sendReset(recipient, badToken)).rejects.toThrow(
        deliveryMessage,
      );
      expect(smtp.createTransport).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined,
    {},
    { accepted: [], rejected: [] },
    { accepted: ['other@example.com'], rejected: [] },
    { accepted: [recipient, 'other@example.com'], rejected: [] },
    { accepted: [recipient], rejected: [recipient] },
    { accepted: [recipient] },
  ])(
    'rejects an unconfirmed or partial SMTP acknowledgement',
    async (result) => {
      smtp.sendMail.mockResolvedValue(result);
      await expect(service.sendReset(recipient, token)).rejects.toThrow(
        deliveryMessage,
      );
      expect(smtp.close).toHaveBeenCalledTimes(1);
    },
  );

  it('sanitizes SMTP failures and always releases the transport', async () => {
    smtp.sendMail.mockRejectedValue(
      new Error(`private SMTP failure fixture-password ${recipient} ${token}`),
    );
    let caught: unknown;
    try {
      await service.sendReset(recipient, token);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ServiceUnavailableException);
    expect((caught as ServiceUnavailableException).getResponse()).toEqual({
      statusCode: 503,
      message: deliveryMessage,
      error: 'Service Unavailable',
    });
    expect(JSON.stringify(caught)).not.toContain(token);
    expect(JSON.stringify(caught)).not.toContain('fixture-password');
    expect(JSON.stringify(caught)).not.toContain(recipient);
    expect(smtp.close).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
  });

  it('sanitizes a synchronous transport initialization failure', async () => {
    smtp.createTransport.mockImplementation(() => {
      throw new Error('private fixture-password');
    });
    await expect(service.sendReset(recipient, token)).rejects.toThrow(
      deliveryMessage,
    );
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it('bounds a stalled delivery to 15 seconds without retrying', async () => {
    vi.useFakeTimers();
    smtp.sendMail.mockReturnValue(new Promise(() => {}));
    const result = expect(service.sendReset(recipient, token)).rejects.toThrow(
      deliveryMessage,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(smtp.close).toHaveBeenCalledTimes(1);
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('consumes a late SMTP rejection after the deadline', async () => {
    vi.useFakeTimers();
    let reject!: (reason: Error) => void;
    smtp.sendMail.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const result = expect(service.sendReset(recipient, token)).rejects.toThrow(
      deliveryMessage,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    reject(new Error(`private ${token}`));
    await Promise.resolve();
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
  });

  it('does not let a close error replace a successful SMTP result', async () => {
    smtp.close.mockImplementation(() => {
      throw new Error('private-close');
    });
    await expect(service.sendReset(recipient, token)).resolves.toBeUndefined();
  });
});
