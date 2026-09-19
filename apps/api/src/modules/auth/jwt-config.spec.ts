import { JwtService } from '@nestjs/jwt';
import { verifyAccessToken } from '../../guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { getJwtConfig } from './jwt-config';

describe('JWT configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
    process.env.JWT_ISSUER = 'rfsanz-api';
    process.env.JWT_AUDIENCE = 'rfsanz-clients';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('requires non-empty issuer and audience strings', () => {
    expect(getJwtConfig().issuer).toBe('rfsanz-api');
    process.env.JWT_ISSUER = '';
    expect(() => getJwtConfig()).toThrow('JWT_ISSUER must be a non-empty string');
    process.env.JWT_ISSUER = 'rfsanz-api';
    process.env.JWT_AUDIENCE = '0';
    expect(getJwtConfig().audience).toBe('0');
  });

  it('signs and verifies tokens with the same issuer and audience', async () => {
    const auth = new AuthService(new JwtService());
    const tokens = await auth.login({
      id: 'user-1',
      email: 'operator@example.invalid',
      roles: [],
    } as any);

    const claims = verifyAccessToken(tokens.accessToken, 'a'.repeat(32));
    expect(claims.iss).toBe('rfsanz-api');
    expect(claims.aud).toBe('rfsanz-clients');
  });

  it('rejects a token signed with a different issuer', () => {
    const token = new JwtService().sign(
      { sub: 'user-1' },
      {
        secret: 'a'.repeat(32),
        algorithm: 'HS256',
        expiresIn: '15m',
        issuer: 'wrong-issuer',
        audience: 'rfsanz-clients',
      },
    );

    expect(() => verifyAccessToken(token, 'a'.repeat(32))).toThrow('Invalid issuer');
  });
});
