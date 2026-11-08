import { PasswordResetEmailService } from '../modules/auth/password-reset-email.service.js';
import { runEmailCheck } from './email-check.js';

function fixture() {
  const mail = new PasswordResetEmailService();
  const configured = vi
    .spyOn(mail, 'assertConfigured')
    .mockImplementation(() => {});
  const verify = vi.spyOn(mail, 'verifyConnection').mockResolvedValue();
  const output = { log: vi.fn(), error: vi.fn() };
  return { mail, configured, verify, output };
}
afterEach(() => vi.restoreAllMocks());

it('validates configuration locally without networking', async () => {
  const f = fixture();
  expect(await runEmailCheck(['--config-only'], f.mail, f.output)).toBe(0);
  expect(f.configured).toHaveBeenCalledOnce();
  expect(f.verify).not.toHaveBeenCalled();
  expect(f.output.log).toHaveBeenCalledWith(
    expect.stringContaining('ainda não verificadas'),
  );
});
it('checks the actual connection by default', async () => {
  const f = fixture();
  expect(await runEmailCheck([], f.mail, f.output)).toBe(0);
  expect(f.verify).toHaveBeenCalledOnce();
  expect(f.output.log).toHaveBeenCalledWith(
    expect.stringContaining('Nenhum e-mail enviado'),
  );
});
it.each([['--unknown'], ['--config-only', '--other'], ['private-secret']])(
  'rejects unsupported arguments without printing them: %s',
  async (...args) => {
    const f = fixture();
    expect(await runEmailCheck(args, f.mail, f.output)).toBe(1);
    expect(f.configured).not.toHaveBeenCalled();
    expect(f.verify).not.toHaveBeenCalled();
    expect(JSON.stringify(f.output.error.mock.calls)).not.toContain(
      'private-secret',
    );
  },
);
it('stops before networking on invalid configuration without printing secrets', async () => {
  const f = fixture();
  f.configured.mockImplementation(() => {
    throw new Error('private-secret');
  });
  expect(await runEmailCheck([], f.mail, f.output)).toBe(1);
  expect(f.verify).not.toHaveBeenCalled();
  expect(JSON.stringify(f.output.error.mock.calls)).not.toContain(
    'private-secret',
  );
});
it('returns failure without exposing authentication or transport details', async () => {
  const f = fixture();
  f.verify.mockRejectedValue(new Error('private-secret'));
  expect(await runEmailCheck([], f.mail, f.output)).toBe(1);
  expect(f.output.log).not.toHaveBeenCalled();
  expect(JSON.stringify(f.output.error.mock.calls)).not.toContain(
    'private-secret',
  );
});
