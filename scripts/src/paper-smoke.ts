export {};

import { loadPaperEnvironment, paperAuthHeaders, preflightPaper } from './paper-harness.ts';

loadPaperEnvironment();
const baseUrl = process.env.PAPER_API_URL ?? 'http://127.0.0.1:3001';
const endpoint = `${baseUrl.replace(/\/$/, '')}/health/readiness`;

async function main(): Promise<void> {
  const preflight = await preflightPaper(baseUrl);
  if (!preflight.ok) {
    console.error(preflight.message);
    process.exitCode = preflight.exitCode;
    return;
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: paperAuthHeaders('preflight', 'paper-smoke-preflight'),
    });
  } catch (error) {
    console.error(`BLOCKED PAPER readiness: ${endpoint} is unreachable (${(error as Error).message})`);
    process.exitCode = 1;
    return;
  }

  const payload = await response.json() as {
    data?: { ready?: boolean; checks?: Record<string, boolean> };
  };
  const report = payload.data ?? {};
  if (!response.ok || report.ready !== true) {
    console.error(`FAIL PAPER readiness: ready=${String(report.ready)}; trade smoke test was not executed`);
    process.exitCode = 1;
    return;
  }

  const required = ['DATABASE_READY', 'CONFIG_VALID', 'EXCHANGE_READY', 'RECONCILIATION_READY', 'RISK_READY', 'AI_READY', 'LEARNING_READY'];
  const missing = required.filter((key) => report.checks?.[key] !== true);
  if (missing.length > 0) {
    console.error(`FAIL PAPER readiness checks: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS PAPER readiness: ${endpoint}`);

  const fixtureEndpoint = `${baseUrl.replace(/\/$/, '')}/api/trading/paper-smoke`;
  let fixtureResponse: Response;
  try {
    fixtureResponse = await fetch(fixtureEndpoint, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer paper-smoke',
        ...paperAuthHeaders('smoke', 'paper-smoke-fixture'),
      },
    });
  } catch (error) {
    console.error(`BLOCKED PAPER trade fixture: ${fixtureEndpoint} is unreachable (${(error as Error).message})`);
    process.exitCode = 1;
    return;
  }

  const fixturePayload = await fixtureResponse.json() as {
    data?: {
      data?: { checks?: Record<string, boolean>; reconciliation?: { mismatches?: string[] } };
      message?: string;
    };
  };
  const fixture = fixturePayload.data?.data;
  if (!fixtureResponse.ok || !fixture?.checks || Object.values(fixture.checks).some((value) => value !== true)) {
    console.error(`FAIL PAPER trade fixture: ${fixturePayload.data?.message ?? JSON.stringify(fixturePayload)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`PASS PAPER trade fixture: ${fixtureEndpoint}`);
  console.log(`PASS PAPER persistence checks: ${Object.keys(fixture.checks).join(', ')}`);
  console.log(`PASS PAPER reconciliation: mismatches=${fixture.reconciliation?.mismatches?.length ?? 0}`);
}

void main();
