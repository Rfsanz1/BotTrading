import crypto from 'crypto';

const FORMAT_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;

export function getBinanceCredentialEnv(mode: 'TESTNET' | 'LIVE'): {
  apiKey: 'BINANCE_TESTNET_API_KEY' | 'BINANCE_LIVE_API_KEY';
  apiSecret: 'BINANCE_TESTNET_API_SECRET' | 'BINANCE_LIVE_API_SECRET';
} {
  return mode === 'TESTNET'
    ? { apiKey: 'BINANCE_TESTNET_API_KEY', apiSecret: 'BINANCE_TESTNET_API_SECRET' }
    : { apiKey: 'BINANCE_LIVE_API_KEY', apiSecret: 'BINANCE_LIVE_API_SECRET' };
}

export class CredentialCryptoService {
  private readonly masterKey: Buffer;

  constructor(masterKey = process.env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY) {
    if (!masterKey) {
      throw new Error('EXCHANGE_CREDENTIAL_ENCRYPTION_KEY is required');
    }
    this.masterKey = CredentialCryptoService.decodeMasterKey(masterKey);
  }

  encrypt(secret: string): string {
    if (!secret) throw new Error('Credential secret cannot be empty');
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      FORMAT_VERSION,
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':');
  }

  decrypt(value: string): string {
    const parts = typeof value === 'string' ? value.split(':') : [];
    if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
      throw new Error('Unsupported or malformed encrypted credential');
    }
    try {
      const iv = Buffer.from(parts[1], 'base64url');
      const tag = Buffer.from(parts[2], 'base64url');
      const ciphertext = Buffer.from(parts[3], 'base64url');
      if (iv.length !== IV_BYTES || tag.length !== 16 || ciphertext.length === 0) {
        throw new Error('Invalid encrypted credential components');
      }
      const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Encrypted credential authentication failed');
    }
  }

  private static decodeMasterKey(value: string): Buffer {
    const key = /^[0-9a-f]{64}$/i.test(value)
      ? Buffer.from(value, 'hex')
      : Buffer.from(value, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error('EXCHANGE_CREDENTIAL_ENCRYPTION_KEY must encode exactly 32 bytes');
    }
    return key;
  }
}
