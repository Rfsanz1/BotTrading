import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import prisma from '../../../../packages/database/src/client';
import * as bcrypt from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';

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
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) return null;
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return null;
    return user;
  }

  async login(user: any) {
    const payload = { sub: user.id, email: user.email, roles: user.roles };
    const access = this.jwt.sign(payload, { expiresIn: '15m' });
    const refresh = this.jwt.sign({ sub: user.id }, { expiresIn: '7d', secret: process.env.JWT_REFRESH_SECRET || 'dev_refresh' });
    // persist refresh token
    await prisma.refreshToken.create({ data: { token: refresh, userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) } });
    return { accessToken: access, refreshToken: refresh };
  }

  async refresh(refreshToken: string) {
    const rec = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!rec) throw new UnauthorizedException();
    // TODO: check expiry
    const user = await prisma.user.findUnique({ where: { id: rec.userId } });
    if (!user) throw new NotFoundException();
    const payload = { sub: user.id, email: user.email, roles: user.roles };
    const access = this.jwt.sign(payload, { expiresIn: '15m' });
    return { accessToken: access };
  }
}
