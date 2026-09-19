import crypto from 'crypto';

export function verifyWebhookSignature(
  rawBody: string,
  signature: string | undefined,
  timestamp: string | undefined,
  secret = process.env.WEBHOOK_HMAC_SECRET,
): boolean {
  if (!secret || !signature || !timestamp) return false;
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber) > 300_000) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const actual = signature.replace(/^sha256=/, '');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}
