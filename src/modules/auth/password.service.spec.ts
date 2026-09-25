import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();
  it('salts passwords independently, verifies the original and rejects incorrect passwords', async () => {
    const password = 'a long test password';
    const first = await service.hash(password);
    const second = await service.hash(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await service.verify(password, first)).toBe(true);
    expect(await service.verify('incorrect password', first)).toBe(false);
  }, 15_000);

  it.each([undefined, 'plaintext', 'scrypt$999999999$8$1$invalid$invalid'])(
    'rejects unsupported or malformed hash %s',
    async (stored) => {
      expect(await service.verify('a long test password', stored)).toBe(false);
    },
    10_000,
  );
});
