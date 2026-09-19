import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { getJwtConfig } from './jwt-config';

const jwtConfig = getJwtConfig();

@Module({
  imports: [PassportModule, JwtModule.register({
    secret: jwtConfig.accessSecret,
    signOptions: {
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
      algorithm: 'HS256',
    },
  })],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
