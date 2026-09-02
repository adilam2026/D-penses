import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';

/**
 * `configureModule` permet aux suites qui ont besoin d'intercepter un envoi
 * réel (email OTP — cf. test/support/fake-mailer.ts) de substituer un
 * provider avant compilation, sans jamais toucher au reste de l'app —
 * paramètre optionnel, tous les appels existants restent inchangés.
 */
export async function createTestApp(configureModule?: (builder: TestingModuleBuilder) => TestingModuleBuilder): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (configureModule) builder = configureModule(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return app;
}
