import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { RlsContextService } from './rls-context.service';

/**
 * Enveloppe chaque requête authentifiée dans le contexte RLS (docs/04 §S.2).
 * S'exécute après le JwtAuthGuard (qui peuple request.user) et avant le handler.
 * Les routes @Public() ne sont pas enveloppées — elles n'ont pas encore d'utilisateur.
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(
    private readonly rlsContext: RlsContextService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return next.handle();

    const request = context.switchToHttp().getRequest();
    const user = request.user as { sub: string; householdId: string | null } | undefined;
    if (!user) return next.handle(); // ne devrait pas arriver derrière JwtAuthGuard

    return from(this.rlsContext.run(user.sub, user.householdId, () => firstValueFrom(next.handle())));
  }
}
