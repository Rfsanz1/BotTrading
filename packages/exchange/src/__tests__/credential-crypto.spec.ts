import crypto from 'crypto';
import { CredentialCryptoService, getBinanceCredentialEnv } from '../services/credential-crypto.service';
import { redactCredentialText } from '../services/credential-redaction';

describe('exchange credential security', () => {
  const key = crypto.randomBytes(32).toString('base64');

  it('encrypts and decrypts secrets without deterministic ciphertext', () => {
    const service = new CredentialCryptoService(key);
    const first = service.encrypt('test-only-secret');
    const second = service.encrypt('test-only-secret');

    expect(first).not.toBe(second);
    expect(service.decrypt(first)).toBe('test-only-secret');
    expect(service.decrypt(second)).toBe('test-only-secret');
  });

  it('rejects tampered, malformed, old-version, and wrong-key ciphertext', () => {
    const service = new CredentialCryptoService(key);
    const encrypted = service.encrypt('test-only-secret');
    const parts = encrypted.split(':');
    parts[3] = `${parts[3]}A`;

    expect(() => service.decrypt(parts.join(':'))).toThrow('authentication failed');
    expect(() => service.decrypt('v0:bad:bad:bad')).toThrow('Unsupported or malformed');
    expect(() => service.decrypt('v1:bad')).toThrow('Unsupported or malformed');
    expect(() => new CredentialCryptoService(crypto.randomBytes(32).toString('base64')).decrypt(encrypted))
      .toThrow('authentication failed');
  });

  it('fails closed when the master key is missing or invalid', () => {
    expect(() => new CredentialCryptoService('')).toThrow('required');
    expect(() => new CredentialCryptoService('too-short')).toThrow('exactly 32 bytes');
  });

  it('redacts secrets and signed query values from diagnostics', () => {
    const message = 'https://api.test/v3/order?apiKey=test-key&signature=abc123';
    const redacted = redactCredentialText(message, ['test-key', 'test-only-secret']);
    expect(redacted).not.toContain('test-key');
    expect(redacted).not.toContain('abc123');
    expect(redacted).toContain('[REDACTED]');
  });

  it('keeps TESTNET and LIVE credential names separate', () => {
    expect(getBinanceCredentialEnv('TESTNET')).toEqual({
      apiKey: 'BINANCE_TESTNET_API_KEY',
      apiSecret: 'BINANCE_TESTNET_API_SECRET',
    });
    expect(getBinanceCredentialEnv('LIVE')).toEqual({
      apiKey: 'BINANCE_LIVE_API_KEY',
      apiSecret: 'BINANCE_LIVE_API_SECRET',
    });
  });
});
