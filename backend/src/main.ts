import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  app.use(helmet());

  // W1.5 (Web/PWA) : origines explicites en production (jamais de wildcard) ;
  // comportement permissif conservé hors production tant que CORS_ORIGINS
  // n'est pas renseigné, pour ne pas casser le dev local ni le mobile natif
  // (qui n'envoie de toute façon pas d'en-tête Origin).
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (process.env.NODE_ENV === 'production') {
    if (corsOrigins.length === 0) {
      throw new Error('CORS_ORIGINS est obligatoire en production (liste explicite d\'origines, jamais de wildcard).');
    }
    app.enableCors({ origin: corsOrigins });
  } else {
    app.enableCors(corsOrigins.length > 0 ? { origin: corsOrigins } : undefined);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  new Logger('Bootstrap').log(`Application démarrée sur le port ${port}`);
}

bootstrap();
