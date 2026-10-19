import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotImplementedException,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthUser } from '../../common/auth-user';
import { CurrentUser, Public } from '../../common/decorators';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  GoogleLoginDto,
  LoginDto,
  OtpRequestDto,
  OtpVerifyDto,
  RegisterDto,
  ResetPasswordDto,
  TokenDto,
  TotpCodeDto,
} from './dto/auth.dto';
import { IssuedSession, SessionMeta, SessionService } from './session.service';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@ApiTags('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } }) // 10 requêtes/min sur l'authentification (§13.1)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.register(dto, meta(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(dto, meta(req)));
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  async google(
    @Body() dto: GoogleLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.loginWithGoogle(dto.idToken, dto.totpCode, meta(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedException('Session absente');
    return this.respond(res, await this.sessions.rotate(token, meta(req)));
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (token) await this.sessions.revoke(token);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  @Public()
  @Post('email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  verifyEmail(@Body() dto: TokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { message: 'Si un compte existe, un e-mail vient de partir.' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  reset(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @ApiBearerAuth()
  @Post('2fa/setup')
  setupTotp(@CurrentUser() user: AuthUser) {
    return this.auth.setupTotp(user.id);
  }

  @ApiBearerAuth()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verifyTotp(
    @CurrentUser() user: AuthUser,
    @Body() dto: TotpCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.confirmTotp(user.id, dto.code, meta(req)));
  }

  /** CPT-03 (Devrait) : en attente du choix du prestataire SMS. */
  @Public()
  @Post('otp/request')
  otpRequest(@Body() _dto: OtpRequestDto) {
    throw new NotImplementedException('Connexion par SMS pas encore disponible');
  }

  @Public()
  @Post('otp/verify')
  otpVerify(@Body() _dto: OtpVerifyDto) {
    throw new NotImplementedException('Connexion par SMS pas encore disponible');
  }

  private respond(res: Response, session: IssuedSession) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      expires: session.refreshExpiresAt,
    });
    return { accessToken: session.accessToken, tokenType: 'Bearer' };
  }
}

function meta(req: Request): SessionMeta {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}
