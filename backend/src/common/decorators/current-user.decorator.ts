import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  sub: string; // userId
  householdId: string | null;
  /** Code à 6 chiffres pas encore défini : seules les routes @AllowPinSetup() restent accessibles. */
  pinRequired?: boolean;
}

/** Extrait l'utilisateur authentifié (payload JWT) de la requête. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
