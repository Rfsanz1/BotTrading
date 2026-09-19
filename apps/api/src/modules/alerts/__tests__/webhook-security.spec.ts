import crypto from 'crypto';
import { verifyWebhookSignature } from '../webhook-security';

describe('webhook security', () => {
  const secret = 'test-webhook-secret-that-is-at-least-32-bytes';
  const body = JSON.stringify({ symbol: 'BTCUSDT', action: 'BUY' });

  it('accepts a fresh valid HMAC and rejects replay/stale signatures', () => {
    const timestamp = String(Date.now());
    const signature = crypto.createHmac('sha256', secret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    expect(verifyWebhookSignature(body, `sha256=${signature}`, timestamp, secret)).toBe(true);
    expect(verifyWebhookSignature(body, `sha256=${signature}`, String(Date.now() - 301_000), secret)).toBe(false);
    expect(verifyWebhookSignature(body, `sha256=${signature.slice(0, -1)}0`, timestamp, secret)).toBe(false);
  });

  it('fails closed when authentication headers or secret are missing', () => {
    expect(verifyWebhookSignature(body, undefined, String(Date.now()), secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'bad', String(Date.now()), secret)).toBe(false);
    expect(verifyWebhookSignature(body, 'bad', String(Date.now()), undefined)).toBe(false);
  });
});
