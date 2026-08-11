/** Headless smoke test: run one full scan and print the result. */
import { loadConfig } from '../main/config.js';
import { scanClaudeCredits } from '../main/scanner/creditScanner.js';
import { scanAll } from '../main/scanner/scanAll.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const result = await scanAll(config);

  for (const snap of result.summary.snapshots) {
    console.log(`${snap.client}: state=${snap.state} detail=${snap.detail ?? '-'}`);
    if (snap.claude) {
      console.log(
        `  session pid=${snap.claude.pid} status=${snap.claude.status ?? '-'} ` +
          `name=${snap.claude.name ?? '-'} cwd=${snap.claude.cwd} ` +
          `updatedAt=${new Date(snap.claude.updatedAt).toISOString()}`
      );
    }
    if (snap.codex) {
      console.log(
        `  thread title=${snap.codex.title || '-'} cwd=${snap.codex.cwd || '-'} ` +
          `updatedAt=${new Date(snap.codex.updatedAt).toISOString()}`
      );
    }
  }

  const credits = await scanClaudeCredits(config.credit);
  console.log(`claude credits: ${JSON.stringify(credits)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
