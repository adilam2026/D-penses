import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from './common/decorators/current-user.decorator';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    // commit : commit réellement déployé (fourni par Railway), utilisé par la CI
    // post-déploiement pour attendre la bonne version avant de la vérifier.
    return { status: 'ok', timestamp: new Date().toISOString(), commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
