import { loadPaperEnvironment, paperAuthHeaders } from './paper-harness.ts';

loadPaperEnvironment();
const baseUrl = (process.env.PAPER_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');

async function main(): Promise<void> {
  const response = await fetch(`${baseUrl}/health/operational`, {
    headers: paperAuthHeaders('status', 'paper-status'),
  });
  const payload = await response.json() as { data?: { state?: string }; [key: string]: unknown };
  console.log(JSON.stringify(payload, null, 2));
  if (!response.ok || payload.data?.state === 'FAILED') process.exitCode = 1;
}

void main().catch((error) => {
  console.error(`BLOCKED PAPER status: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
