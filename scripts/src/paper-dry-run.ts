import { loadPaperEnvironment } from './paper-harness.ts';

loadPaperEnvironment();

async function main(): Promise<void> {
  if (process.env.TRADING_MODE !== 'PAPER' || process.env.LIVE_TRADING_ENABLED !== 'false') {
    throw new Error('PAPER dry-run requires TRADING_MODE=PAPER and LIVE_TRADING_ENABLED=false');
  }
  const baseUrl = (process.env.PAPER_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/health/operational`);
  const report = await response.json() as { data?: { state?: string; components?: Record<string, string> } };
  if (!response.ok || report.data?.state === 'FAILED') throw new Error(`startup health failed: ${JSON.stringify(report)}`);
  console.log('PASS PAPER startup dry-run: initialization and safety guard verified; no exchange order submitted');
}

void main().catch((error) => {
  console.error(`FAIL PAPER startup dry-run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
