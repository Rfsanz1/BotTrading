import { Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

const opts: any = {
  jwtFromRequest: (req) => req?.headers?.authorization?.startsWith('Bearer ') ? req.headers.authorization.split(' ')[1] : null,
  secretOrKey: process.env.JWT_ACCESS_SECRET || 'dev',
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() { super(opts); }
  async validate(payload: any) {
    return { sub: payload.sub, email: payload.email, roles: payload.roles };
  }
}
