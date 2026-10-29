import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { VerifyEmailOtpDto } from './dto/verify-email-otp.dto';
import { ResendEmailOtpDto } from './dto/resend-email-otp.dto';
import { PinResetCompleteDto, PinResetRequestDto, PinResetVerifyDto, SetPinDto, UnlockDto } from './dto/pin.dto';
import { IpRateLimitGuard } from './ip-rate-limit.guard';
import { Public } from '../common/decorators/public.decorator';
import { AllowPinSetup } from '../common/decorators/allow-pin-setup.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @UseGuards(IpRateLimitGuard)
  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @UseGuards(IpRateLimitGuard)
  @Post('verify-email-otp')
  @HttpCode(HttpStatus.OK)
  verifyEmailOtp(@Body() dto: VerifyEmailOtpDto, @Req() req: Request) {
    return this.auth.verifyEmailOtp(dto.email, dto.code, req.headers['user-agent']);
  }

  @Public()
  @UseGuards(IpRateLimitGuard)
  @Post('resend-email-otp')
  @HttpCode(HttpStatus.OK)
  resendEmailOtp(@Body() dto: ResendEmailOtpDto) {
    return this.auth.resendEmailOtp(dto.email);
  }

  @Public()
  @UseGuards(IpRateLimitGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, req.headers['user-agent']);
  }

  /** Déverrouillage : code vérifié côté serveur pour l'utilisateur de la session. */
  @Public()
  @UseGuards(IpRateLimitGuard)
  @Post('unlock')
  @HttpCode(HttpStatus.OK)
  unlock(@Body() dto: UnlockDto, @Req() req: Request) {
    return this.auth.unlock(dto.refreshToken, dto.pin, req.headers['user-agent']);
  }

  /** Identité de la session + transition requise — accessible avant la création du code. */
  @AllowPinSetup()
  @Get('session')
  session(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.sessionInfo(user.sub);
  }

  /** Création (transition) ou changement du code à 6 chiffres. */
  @AllowPinSetup()
  @UseGuards(IpRateLimitGuard)
  @Post('pin')
  @HttpCode(HttpStatus.OK)
  setPin(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetPinDto, @Req() req: Request) {
    return this.auth.setPin(user.sub, dto.currentCredential, dto.newPin, req.headers['user-agent']);
  }

  @Public()
  @UseGuards(IpRateLimitGuard)
  @Post('pin-reset/request')
  @HttpCode(HttpStatus.OK)
  requestPinReset(@Body() dto: PinResetRequestDto) {
    return this.auth.requestPinReset(dto.email);
  }

  @Public()
  @UseGuards(IpRateLimitGuard)
  @Post('pin-reset/verify')
  @HttpCode(HttpStatus.OK)
  verifyPinReset(@Body() dto: PinResetVerifyDto) {
    return this.auth.verifyPinReset(dto.email, dto.code);
  }

  @Public()
  @UseGuards(IpRateLimitGuard)
  @Post('pin-reset/complete')
  @HttpCode(HttpStatus.OK)
  completePinReset(@Body() dto: PinResetCompleteDto, @Req() req: Request) {
    return this.auth.completePinReset(dto.resetToken, dto.newPin, req.headers['user-agent']);
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

  @AllowPinSetup()
  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logoutAll(user.sub);
  }
}
