import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import prisma from '@rfsanz/database';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { getJwtConfig } from './jwt-config';

type AuthUser = Prisma.UserGetPayload<{
  include: { roles: { include: { role: true } } };
}>;

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async register(email: string, password: string, name?: string) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new Error('User exists');
    const hash = await bcrypt.hash(password, 10);
    const u = await prisma.user.create({ data: { email, password: hash, name } });
    return { id: u.id, email: u.email };
  }

  async validateUser(email: string, password: string) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } },
    });
    if (!user || !user.password) return null;
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return null;
    return user;
  }

  async login(user: AuthUser) {
    let jwtConfig;
    try {
      jwtConfig = getJwtConfig();
    } catch {
      throw new UnauthorizedException('JWT authentication is not configured');
    }
    const payload = {
      sub: user.id,
      email: user.email,
      roles: user.roles.map(({ role }) => role.name),
    };
    const tokenClaims = {
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
    };
    const access = this.jwt.sign(payload, {
      expiresIn: '15m',
      secret: jwtConfig.accessSecret,
      algorithm: 'HS256',
      ...tokenClaims,
    });
    const refresh = this.jwt.sign({ sub: user.id }, {
      expiresIn: '7d',
      secret: jwtConfig.refreshSecret,
      algorithm: 'HS256',
      ...tokenClaims,
    });
    return { accessToken: access, refreshToken: refresh };
  }

  async refresh(refreshToken: string) {
    let jwtConfig;
    try {
      jwtConfig = getJwtConfig();
    } catch {
      throw new UnauthorizedException('JWT authentication is not configured');
    }
    let payload: { sub?: string };
    try {
      payload = this.jwt.verify<{ sub?: string }>(refreshToken, {
        secret: jwtConfig.refreshSecret,
        algorithms: ['HS256'],
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
      });
    } catch {
      throw new UnauthorizedException();
    }
    if (!payload.sub) throw new UnauthorizedException();

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException();
    const access = this.jwt.sign({
      sub: user.id,
      email: user.email,
      roles: user.roles.map(({ role }) => role.name),
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
    }, {
      expiresIn: '15m',
      secret: jwtConfig.accessSecret,
      algorithm: 'HS256',
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
    });
    return { accessToken: access };
  }
}
