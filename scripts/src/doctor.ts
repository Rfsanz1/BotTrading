import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, resolve } from 'node:path';

type Result = 'PASS' | 'FAIL' | 'BLOCKED';
type Check = { name: string; result: Result; reason: string };
const root = resolve(dirname(new URL(import.meta.url).pathname), '../..');
const paperEnvPath = resolve(root, 'apps/api/.env.paper');
const exampleEnvPath = resolve(root, 'apps/api/.env.paper.example');
const envPath = existsSync(paperEnvPath)
  ? paperEnvPath
  : existsSync(exampleEnvPath)
    ? exampleEnvPath
    : null;

function loadEnv(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return result;
}

const env = { ...process.env, ...(envPath ? loadEnv(envPath) : {}) };
const results: Check[] = [];

function record(result: Result, name: string, reason: string): Check {
  const check = { result, name, reason };
  results.push(check);
  console.log(`${result.padEnd(7)} ${name}: ${reason}`);
  return check;
}

function tcpProbe(host: string, port: number): Promise<void> {
  return new Promise((resolveProbe, reject) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('timeout'));
    }, 1500);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolveProbe();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function parseServiceUrl(name: string, fallbackPort: number): URL | null {
  const value = env[name];
  if (!value) {
    record('FAIL', name, 'environment variable is missing');
    return null;
  }
  try {
    const url = new URL(value);
    if (!url.port) url.port = String(fallbackPort);
    return url;
  } catch {
    record('FAIL', name, 'URL is invalid');
    return null;
  }
}

async function checkDatabase(): Promise<void> {
  const url = parseServiceUrl('DATABASE_URL', 5432);
  if (!url) return;
  try {
    await tcpProbe(url.hostname, Number(url.port));
    record('PASS', 'PostgreSQL TCP', `${url.hostname}:${url.port} is reachable`);
  } catch (error) {
    record('BLOCKED', 'PostgreSQL TCP', `${url.hostname}:${url.port} is unreachable (${(error as Error).message})`);
    return;
  }
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'status', '--schema=prisma/schema.prisma'], {
      cwd: resolve(root, 'packages/database'),
      env,
      stdio: 'pipe',
      timeout: 15000,
    });
    record('PASS', 'Authentication/Prisma/migrations', 'authentication and migration status succeeded');
  } catch {
    record('FAIL', 'Prisma connectivity/migrations', 'server is reachable but Prisma status failed');
  }

}

async function checkRedis(): Promise<void> {
  const url = parseServiceUrl('REDIS_URL', 6379);
  if (!url) return;
  try {
    await tcpProbe(url.hostname, Number(url.port));
    record('PASS', 'Redis TCP', `${url.hostname}:${url.port} is reachable`);
  } catch (error) {
    record('FAIL', 'Redis TCP', `${url.hostname}:${url.port} is unreachable (${(error as Error).message})`);
  }

}

async function checkDatabaseOnly(): Promise<void> {
  await checkDatabase();
}

async function checkRedisOnly(): Promise<void> {
  await checkRedis();
}

async function checkApiPort(): Promise<void> {
  const port = Number(env.PORT || 3001);
  try {
    await tcpProbe('127.0.0.1', port);
    record('FAIL', 'API port', `127.0.0.1:${port} is already occupied`);
  } catch {
    record('PASS', 'API port', `127.0.0.1:${port} is available`);
  }
}

function checkStaticRequirements(): void {
  record(
    env.TRADING_MODE === 'PAPER' && env.LIVE_TRADING_ENABLED === 'false' ? 'PASS' : 'FAIL',
    'PAPER configuration',
    env.TRADING_MODE === 'PAPER' && env.LIVE_TRADING_ENABLED === 'false'
      ? 'PAPER mode is fail-closed'
      : 'TRADING_MODE must be PAPER and LIVE_TRADING_ENABLED must be false',
  );
  const hasPrismaClient =
    existsSync(resolve(root, 'packages/database/node_modules/@prisma/client')) ||
    existsSync(resolve(root, 'node_modules/@prisma/client'));
  record(
    hasPrismaClient ? 'PASS' : 'FAIL',
    'Prisma client',
    hasPrismaClient ? 'generated client package is present' : 'run pnpm --dir packages/database prisma:generate',
  );
  const migrationRoot = resolve(root, 'packages/database/prisma/migrations');
  const migrationFiles = [
    '0001_init/migration.sql',
    '0002_add_phase2_features/migration.sql',
    '0002_learning_phase3/migration.sql',
  ];
  const hasMigrations = migrationFiles.every((file) => existsSync(resolve(migrationRoot, file)));
  record(
    hasMigrations ? 'PASS' : 'FAIL',
    'Prisma migrations',
    'required migration files are present',
  );
  record(
    env.JWT_ACCESS_SECRET && env.JWT_REFRESH_SECRET ? 'PASS' : 'FAIL',
    'Required environment',
    env.JWT_ACCESS_SECRET && env.JWT_REFRESH_SECRET ? 'PAPER JWT secrets are configured' : 'JWT secrets are missing',
  );
}

function writeEnvironmentReport(): void {
  const report = {
    timestamp: new Date().toISOString(),
    node: results.some((item) => item.name === 'Node' && item.result === 'PASS'),
    pnpm: results.some((item) => item.name === 'pnpm' && item.result === 'PASS'),
    postgres: results.some((item) => item.name === 'PostgreSQL TCP' && item.result === 'PASS'),
    redis: results.some((item) => item.name === 'Redis TCP' && item.result === 'PASS'),
    prisma: results.some((item) => item.name.includes('Prisma') && item.result === 'PASS'),
    paperConfig: results.some((item) => item.name === 'PAPER configuration' && item.result === 'PASS'),
    environmentReady: results.every((item) => item.result === 'PASS'),
    blockingReasons: results
      .filter((item) => item.result !== 'PASS')
      .map((item) => `${item.name}: ${item.reason}`),
  };
  writeFileSync(resolve(root, 'environment-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'all';
  console.log(`Environment: ${envPath ?? 'no paper environment file found'}`);
  if (mode === 'all') {
    record('PASS', 'Node', process.version);
    try {
      record('PASS', 'pnpm', execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim());
    } catch {
      record('FAIL', 'pnpm', 'pnpm is not available');
    }
    checkStaticRequirements();
    await Promise.all([checkDatabase(), checkRedis(), checkApiPort()]);
    writeEnvironmentReport();
  } else if (mode === 'db') {
    await checkDatabaseOnly();
  } else if (mode === 'redis') {
    await checkRedisOnly();
  } else {
    console.error(`Unknown doctor mode: ${mode}. Use all, db, or redis.`);
    process.exitCode = 2;
    return;
  }
  const failed = results.filter(({ result }) => result === 'FAIL').length;
  const blocked = results.filter(({ result }) => result === 'BLOCKED').length;
  console.log(`Summary: PASS=${results.length - failed - blocked} FAIL=${failed} BLOCKED=${blocked}`);
  process.exitCode = failed || blocked ? 1 : 0;
}

void main();
