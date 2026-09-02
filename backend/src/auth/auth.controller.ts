import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { ResendEmailOtpDto } from './dto/resend-email-otp.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @Post('verify-email-otp')
  @HttpCode(HttpStatus.OK)
  verifyEmailOtp(@Body() dto: VerifyEmailOtpDto, @Req() req: Request) {
    return this.auth.verifyEmailOtp(dto.email, dto.code, req.headers['user-agent']);
  }

  @Public()
  @Post('resend-email-otp')
  @HttpCode(HttpStatus.OK)
  resendEmailOtp(@Body() dto: ResendEmailOtpDto) {
    return this.auth.resendEmailOtp(dto.email);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, req.headers['user-agent']);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logoutAll(user.sub);
  }
}
