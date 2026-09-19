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
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/trading/paper-failure`, {
    method: 'POST',
    headers: paperAuthHeaders('failure', 'paper-failure'),
  });
  const body = await response.json() as { data?: { data?: { scenarios?: Array<{ scenario: string; status?: string; persistence?: Record<string, boolean> }> } } };
  const scenarios = body.data?.data?.scenarios ?? [];
  const failed = scenarios.filter((scenario) =>
    scenario.status !== 'PASS' &&
    scenario.status !== 'NOT IMPLEMENTED' ||
    Object.values(scenario.persistence ?? {}).some((value) => !value));
  if (!response.ok || scenarios.length === 0 || failed.length > 0) {
    console.error(`FAIL PAPER failure-test: ${JSON.stringify(body)}`);
    process.exitCode = 1;
    return;
  }
  console.log('PASS PAPER failure-test: timeout/unknown persistence scenario');
  console.log(`Evidence: ${JSON.stringify(body.data?.data)}`);
}

void main().catch((error) => {
  console.error(`FAIL PAPER failure-test: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
