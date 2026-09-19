export {};

import { loadPaperEnvironment, preflightPaper } from './paper-harness.ts';

async function main(): Promise<void> {
  loadPaperEnvironment();
  const baseUrl = process.env.PAPER_API_URL ?? 'http://127.0.0.1:3001';
  const result = await preflightPaper(baseUrl);
  console.log(result.message);
  if (!result.ok) process.exitCode = result.exitCode;
}

void main().catch((error) => {
  console.error(`BLOCKED PAPER infrastructure: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
