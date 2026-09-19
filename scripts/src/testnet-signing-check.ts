import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { signedQuery } from './binance-signing.ts';

const secret = 'test-secret';
const timestamp = 1700000000000;
const query = signedQuery(secret, { timestamp, recvWindow: 5000 });
const unsigned = `timestamp=${timestamp}&recvWindow=5000`;
const expected = createHmac('sha256', secret).update(unsigned).digest('hex');
assert.equal(new URLSearchParams(query).get('signature'), expected);
assert.equal(new URLSearchParams(query).get('timestamp'), String(timestamp));
assert.equal(new URLSearchParams(query).get('recvWindow'), '5000');
console.log('PASS TESTNET fixture signing: timestamp, recvWindow, and HMAC signature are present');
