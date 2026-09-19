import { createHmac } from 'node:crypto';

export const TESTNET_API_BASE = 'https://testnet.binance.vision/api';

export function signedQuery(
  secret: string,
  params: Record<string, string | number>,
): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  );
  const signature = createHmac('sha256', secret)
    .update(query.toString())
    .digest('hex');
  query.set('signature', signature);
  return query.toString();
}

export function buildSignedRequestUrl(
  path: string,
  secret: string,
  params: Record<string, string | number> = {},
): string {
  return `${TESTNET_API_BASE}${path}?${signedQuery(secret, {
    ...params,
    timestamp: Date.now(),
    recvWindow: 5000,
  })}`;
}
