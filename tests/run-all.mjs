// Runs every tests/*.mjs (except files starting with '_' and this one) and reports.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.startsWith('_') && f !== 'run-all.mjs').sort();
let failed = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(dir, f)], { stdio: 'inherit', env: process.env });
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${f} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log(`${files.length - failed}/${files.length} test files passed`);
process.exit(failed ? 1 : 0);
