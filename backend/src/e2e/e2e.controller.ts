import { Controller, Headers, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { E2eService } from './e2e.service';

/**
 * Réservé à la recette E2E automatisée (Maestro/CI) sur le backend staging —
 * jamais appelé par l'application mobile elle-même. `@Public()` : aucun JWT
 * (le "compte de test" ici est un email fixe résolu côté serveur, pas un
 * utilisateur connecté), l'autorisation vient uniquement du jeton E2E vérifié
 * dans E2eService.reset() — inerte (404) tant que E2E_TEST_MODE != 'true'.
 */
@Controller('e2e')
export class E2eController {
  constructor(private readonly e2e: E2eService) {}

  @Public()
  @Post('reset')
  reset(@Headers('x-e2e-token') token: string | undefined) {
    return this.e2e.reset(token);
  }
}
