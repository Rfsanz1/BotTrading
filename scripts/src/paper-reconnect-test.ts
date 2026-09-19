export {};

import { loadPaperEnvironment, paperAuthHeaders, preflightPaper } from './paper-harness.ts';

async function main(): Promise<void> {
  loadPaperEnvironment();
  const baseUrl = process.env.PAPER_API_URL ?? 'http://127.0.0.1:3001';
  const preflight = await preflightPaper(baseUrl);
  if (!preflight.ok) {
    console.error(preflight.message);
    process.exitCode = preflight.exitCode;
    return;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/trading/paper-reconnect`, {
    method: 'POST',
    headers: paperAuthHeaders('reconnect', 'paper-reconnect'),
  });
  const body = await response.json() as { data?: { data?: { continuity?: Record<string, boolean>; finalChecks?: Record<string, boolean>; reconciliation?: { mismatches?: string[] } } } };
  const result = body.data?.data;
  if (!response.ok || !result || Object.values(result.continuity ?? {}).some((value) => !value) || Object.values(result.finalChecks ?? {}).some((value) => !value) || (result.reconciliation?.mismatches?.length ?? 1) !== 0) {
    console.error(`FAIL PAPER reconnect-test: ${JSON.stringify(body)}`);
    process.exitCode = 1;
    return;
  }
  console.log('PASS PAPER reconnect-test: genuine PAPER disconnect/reconnect recovery');
  console.log(`Evidence: ${JSON.stringify(result)}`);
}

void main().catch((error) => {
  console.error(`FAIL PAPER reconnect-test: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
