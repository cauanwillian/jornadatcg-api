/** Validate public runtime settings without including environment values in errors. */
export function runtimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const rawPort = env.PORT ?? '3000';
  if (!/^[1-9]\d{0,4}$/.test(rawPort) || Number(rawPort) > 65535)
    throw new Error('PORT deve ser um inteiro entre 1 e 65535.');
  const origins = [
    ...new Set(
      (env.AUTH_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
  const production = env.NODE_ENV === 'production';
  for (const origin of origins) {
    let valid = false;
    try {
      const url = new URL(origin);
      valid =
        url.origin === origin &&
        !url.username &&
        !url.password &&
        (url.protocol === 'https:' ||
          (!production && url.protocol === 'http:'));
    } catch {
      /* Invalid origin. */
    }
    if (!valid)
      throw new Error(
        'AUTH_ALLOWED_ORIGINS deve conter origens HTTP(S) exatas; em produção, use HTTPS.',
      );
  }
  if (production) {
    if (!origins.length)
      throw new Error(
        'Configure AUTH_ALLOWED_ORIGINS antes de iniciar em produção.',
      );
    if (Buffer.byteLength(env.JWT_SECRET?.trim() ?? '') < 32)
      throw new Error(
        'Configure JWT_SECRET com pelo menos 32 bytes antes de iniciar em produção.',
      );
    let database = false;
    try {
      database = ['postgres:', 'postgresql:'].includes(
        new URL(env.DATABASE_URL ?? '').protocol,
      );
    } catch {
      /* Invalid database URL. */
    }
    if (!database)
      throw new Error(
        'Configure DATABASE_URL PostgreSQL antes de iniciar em produção.',
      );
  }
  return { port: Number(rawPort), origins };
}
