import { Controller, Post, Body, Res, HttpCode, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Response, Request } from 'express';

class RegisterDto { email: string; password: string; name?: string }
class LoginDto { email: string; password: string }

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  async register(@Body() body: RegisterDto) {
    return this.auth.register(body.email, body.password, body.name);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validateUser(body.email, body.password);
    if (!user) return { error: 'invalid credentials' };
    const tokens = await this.auth.login(user);
    res.cookie('refresh_token', tokens.refreshToken, { httpOnly: true, sameSite: 'lax' });
    return { accessToken: tokens.accessToken };
  }

  @Post('refresh')
  async refresh(@Req() req: Request) {
    const token = req.cookies?.refresh_token;
    if (!token) return { error: 'missing refresh' };
    return this.auth.refresh(token);
  }
}
