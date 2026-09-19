import { ValidationPipe } from '@nestjs/common';
import { validate } from 'class-validator';
import { AuthController, LoginDto } from './auth.controller';

describe('AuthController login mapping', () => {
  const validEmail = 'controlled-testnet@example.invalid';
  const validPassword = 'long-enough-password';

  async function transformLogin(body: Record<string, unknown>): Promise<LoginDto> {
    return new ValidationPipe({ whitelist: true, transform: true }).transform(body, {
      type: 'body',
      metatype: LoginDto,
      data: '',
    }) as Promise<LoginDto>;
  }

  it('preserves email and password through whitelist validation', async () => {
    const body = await transformLogin({ email: validEmail, password: validPassword, ignored: 'removed' });
    const auth = { validateUser: jest.fn().mockResolvedValue({ id: 'user-1', email: validEmail, roles: [] }), login: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }) };
    const res = { cookie: jest.fn() };

    const result = await new AuthController(auth as any).login(body, res as any);

    expect(auth.validateUser).toHaveBeenCalledWith(validEmail, validPassword);
    expect(result).toEqual({ accessToken: 'access' });
    expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh', { httpOnly: true, sameSite: 'lax' });
    expect(body).not.toHaveProperty('ignored');
  });

  it('rejects wrong or unknown credentials with 401 instead of 500', async () => {
    const auth = { validateUser: jest.fn().mockResolvedValue(null) };
    await expect(new AuthController(auth as any).login(
      await transformLogin({ email: validEmail, password: validPassword }),
      { cookie: jest.fn() } as any,
    )).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    {},
    { password: validPassword },
    { email: validEmail },
    { email: 'not-an-email', password: validPassword },
  ])('rejects invalid login body: %j', async (body) => {
    await expect(transformLogin(body)).rejects.toBeDefined();
  });

  it('does not log credentials while validating the DTO', async () => {
    const body = await transformLogin({ email: validEmail, password: validPassword });
    const serialized = JSON.stringify(body);
    expect(serialized).toContain(validEmail);
    expect(serialized).toContain(validPassword);
    expect(() => JSON.stringify({ message: 'invalid credentials' })).not.toThrow();
  });

  it('keeps DTO validation metadata on both required fields', async () => {
    const errors = await validate(Object.assign(new LoginDto(), { email: validEmail }));
    expect(errors.map((error) => error.property)).toContain('password');
  });
});
