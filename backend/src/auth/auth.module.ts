import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { MailerService } from './mailer.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LoginAttemptsService } from './login-attempts.service';
import { IpRateLimitGuard } from './ip-rate-limit.guard';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, MailerService, JwtStrategy, LoginAttemptsService, IpRateLimitGuard],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
