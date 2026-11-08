import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { runtimeConfig } from './runtime-config.js';

async function bootstrap() {
  const { port, origins } = runtimeConfig();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  if (origins.length)
    app.enableCors({
      origin: origins,
      credentials: true,
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Idempotency-Key',
      ],
    });

  await app.listen(port);
}

void bootstrap();
