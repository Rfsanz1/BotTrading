import { Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';
import { getJwtConfig } from './jwt-config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    const jwtConfig = getJwtConfig();
    super({
      jwtFromRequest: (req) => req?.headers?.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : null,
      secretOrKey: jwtConfig.accessSecret,
      algorithms: ['HS256'],
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
    });
  }
  async validate(payload: any) {
    return { sub: payload.sub, email: payload.email, roles: payload.roles };
  }
}
