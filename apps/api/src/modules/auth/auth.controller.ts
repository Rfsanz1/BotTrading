import { Controller, Post, Body, Res, HttpCode, Req, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Response, Request } from 'express';
import { Public } from '../../common/public.decorator';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  async register(@Body() body: RegisterDto) {
    return this.auth.register(body.email, body.password, body.name);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.validateUser(body.email, body.password);
    if (!user) throw new UnauthorizedException('invalid credentials');
    const tokens = await this.auth.login(user);
    res.cookie('refresh_token', tokens.refreshToken, { httpOnly: true, sameSite: 'lax' });
    return { accessToken: tokens.accessToken };
  }

  @Post('refresh')
  @Public()
  async refresh(@Req() req: Request) {
    const token = req.cookies?.refresh_token;
    if (!token) return { error: 'missing refresh' };
    return this.auth.refresh(token);
  }
}
