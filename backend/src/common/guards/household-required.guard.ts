import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/** Bloque l'accès aux routes qui exigent un foyer actif (toute donnée hors socle/auth/onboarding). */
@Injectable()
export class HouseholdRequiredGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { householdId: string | null } | undefined;
    if (!user?.householdId) {
      throw new ForbiddenException("Aucun foyer actif — créez ou rejoignez d'abord un foyer");
    }
    return true;
  }
}
