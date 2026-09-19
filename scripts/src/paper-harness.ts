import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';

export function loadPaperEnvironment(): void {
  const root = resolve(import.meta.dirname, '../..');
  const path = resolve(root, 'apps/api/.env.paper');
  if (!existsSync(path)) throw new Error(`BLOCKED PAPER infrastructure: missing ${path}`);
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function paperAuthHeaders(control: string, subject: string): Record<string, string> {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || secret.length < 32) throw new Error('PAPER JWT access secret is missing or weak');
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = encode({ sub: subject, email: `${subject}@paper.local`, roles: ['trader'], iat: now, exp: now + 300 });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  const headers: Record<string, string> = {};
  headers['Authorization'] = ['Bearer', [header, payload, signature].join('.')].join(' ');
  headers['x-paper-test-control'] = control;
  return headers;
}

type PreflightResult = { ok: boolean; message: string; exitCode: number };

async function tcpCheck(name: string, rawUrl: string | undefined, defaultPort: number): Promise<PreflightResult> {
  if (!rawUrl) return { ok: false, message: `BLOCKED PAPER infrastructure: ${name} configuration is missing`, exitCode: 1 };
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, message: `BLOCKED PAPER infrastructure: ${name} URL is invalid`, exitCode: 1 };
  }
  const port = Number(parsed.port || defaultPort);
  const host = parsed.hostname;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: `BLOCKED PAPER infrastructure: ${name} URL has no valid host/port`, exitCode: 1 };
  }
  const reachable = await new Promise<boolean>((resolveReachable) => {
    const socket = connect({ host, port, timeout: 5000 });
    socket.once('connect', () => { socket.destroy(); resolveReachable(true); });
    socket.once('error', () => { socket.destroy(); resolveReachable(false); });
    socket.once('timeout', () => { socket.destroy(); resolveReachable(false); });
  });
  if (!reachable) return { ok: false, message: `BLOCKED PAPER infrastructure: ${name} unreachable at ${host}:${port}`, exitCode: 1 };
  return { ok: true, message: `PASS ${name} TCP: ${host}:${port}`, exitCode: 0 };
}

export async function preflightPaper(baseUrl: string): Promise<PreflightResult> {
  const database = await tcpCheck('PostgreSQL', process.env.DATABASE_URL, 5432);
  if (!database.ok) return database;
  const redis = await tcpCheck('Redis', process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', 6379);
  if (!redis.ok) return redis;
  const url = `${baseUrl.replace(/\/$/, '')}/health/readiness`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: paperAuthHeaders('preflight', 'paper-preflight'),
    });
  } catch (error) {
    const cause = (error as Error & { cause?: { code?: string } }).cause;
    const detail = cause?.code === 'ECONNREFUSED' ? 'API not running' : `API unreachable (${(error as Error).message})`;
    return { ok: false, message: `BLOCKED PAPER infrastructure: ${detail} at ${url}`, exitCode: 1 };
  }
  if (!response.ok) return { ok: false, message: `FAIL PAPER readiness: ${url} returned HTTP ${response.status}`, exitCode: 1 };
  let envelope: { data?: { ready?: boolean; phase?: string } };
  try {
    envelope = await response.json() as { data?: { ready?: boolean; phase?: string } };
  } catch {
    return { ok: false, message: `FAIL PAPER readiness: ${url} returned invalid JSON`, exitCode: 1 };
  }
  if (envelope.data?.ready !== true || envelope.data.phase !== 'SYSTEM_READY') {
    return { ok: false, message: `FAIL PAPER readiness: phase=${String(envelope.data?.phase)} ready=${String(envelope.data?.ready)}`, exitCode: 1 };
  }
  return { ok: true, message: 'PASS PAPER preflight: PostgreSQL, Redis, API, and SYSTEM_READY', exitCode: 0 };
}
