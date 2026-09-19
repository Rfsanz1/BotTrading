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
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/trading/paper-restart`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer paper-restart',
      ...paperAuthHeaders('restart', 'paper-restart'),
    },
  });
  const body = await response.json() as {
    data?: { data?: { continuity?: Record<string, boolean>; finalChecks?: Record<string, boolean>; recoveryReconciliation?: { mismatches?: string[] } } };
  };
  const result = body.data?.data;
  if (!response.ok || !result || Object.values(result.continuity ?? {}).some((value) => !value) || Object.values(result.finalChecks ?? {}).some((value) => !value) || (result.recoveryReconciliation?.mismatches?.length ?? 1) !== 0) {
    console.error(`FAIL PAPER restart-test: ${JSON.stringify(body)}`);
    process.exitCode = 1;
    return;
  }
  console.log('PASS PAPER restart-test: in-process lifecycle recovery');
  console.log(`Evidence: ${JSON.stringify(result)}`);
}

void main().catch((error) => {
  console.error(`FAIL PAPER restart-test: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
