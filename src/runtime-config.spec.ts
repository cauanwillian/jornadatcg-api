import { runtimeConfig } from './runtime-config.js';

const production = {
  NODE_ENV: 'production',
  AUTH_ALLOWED_ORIGINS: 'https://loja.example.com',
  JWT_SECRET: 'x'.repeat(32),
  DATABASE_URL: 'postgresql://fixture:fixture@localhost/test',
};
it('keeps local defaults and returns a numeric TCP port', () => {
  expect(runtimeConfig({})).toEqual({ port: 3000, origins: [] });
  expect(runtimeConfig({ PORT: '8080' }).port).toBe(8080);
});
it.each(['0', '-1', '65536', '3000/path', 'abc', '', ' 3000', '03'])(
  'rejects an invalid port without echoing it: %s',
  (PORT) => {
    expect(() => runtimeConfig({ PORT })).toThrow('PORT deve ser um inteiro');
  },
);
it('normalizes whitespace and removes duplicate origins', () => {
  expect(
    runtimeConfig({
      AUTH_ALLOWED_ORIGINS: ' http://localhost:5173, http://localhost:5173 , ',
    }).origins,
  ).toEqual(['http://localhost:5173']);
});
it.each([
  '*',
  'null',
  'https://example.com/path',
  'https://example.com/',
  'https://user:secret@example.com',
  'https://example.com?key=secret',
  'ftp://example.com',
])('rejects unsafe or non-origin CORS entries', (AUTH_ALLOWED_ORIGINS) => {
  expect(() => runtimeConfig({ AUTH_ALLOWED_ORIGINS })).toThrow(
    'AUTH_ALLOWED_ORIGINS',
  );
});
it('accepts production HTTPS origins and PostgreSQL configuration', () => {
  expect(runtimeConfig(production).port).toBe(3000);
});
it.each([
  { AUTH_ALLOWED_ORIGINS: '' },
  { AUTH_ALLOWED_ORIGINS: 'http://example.com' },
  { JWT_SECRET: '' },
  { JWT_SECRET: 'short' },
  { DATABASE_URL: '' },
  { DATABASE_URL: 'https://secret:password@example.com' },
])(
  'fails early on missing production settings without exposing values',
  (overrides) => {
    expect(() => runtimeConfig({ ...production, ...overrides })).toThrow();
    try {
      runtimeConfig({ ...production, ...overrides });
      throw new Error('Expected configuration failure');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('password');
      expect((error as Error).message).not.toContain('short');
      expect((error as Error).message).not.toContain('https://secret');
    }
  },
);
