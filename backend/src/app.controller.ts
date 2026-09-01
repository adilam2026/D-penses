import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from './common/decorators/current-user.decorator';

@Controller()
export class AppController {
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
