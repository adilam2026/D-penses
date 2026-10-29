import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_PIN_SETUP_KEY } from '../decorators/allow-pin-setup.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  /**
   * Tant que le code à 6 chiffres n'est pas défini (ancien mot de passe), le
   * serveur refuse toute route hors @AllowPinSetup() : une session existante
   * ou une ancienne version de l'application ne permet jamais de continuer
   * indéfiniment avec l'ancien mot de passe.
   */
  handleRequest<TUser = AuthenticatedUser>(err: unknown, user: unknown, info: unknown, context: ExecutionContext): TUser {
    const authenticated = super.handleRequest<TUser>(err, user, info, context);
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PIN_SETUP_KEY, [context.getHandler(), context.getClass()]);
    if ((authenticated as AuthenticatedUser | undefined)?.pinRequired && !allowed) {
      throw new ForbiddenException({ message: 'Créez votre code à 6 chiffres pour continuer', code: 'PIN_SETUP_REQUIRED' });
    }
    return authenticated;
  }
}
