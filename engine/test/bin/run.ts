import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../../lib/content.ts';

const DIR = join(ROOT, 'engine/test');
const files = (await readdir(DIR)).filter((f) => f.endsWith('.test.ts')).sort();

let total = 0;
let failed = 0;
const failures: string[] = [];
let current = '';

function check(label: string, actual: unknown, expected: unknown) {
  total += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failed += 1;
    failures.push(
      `  ${current}: ${label}\n      got  ${JSON.stringify(actual)}\n      want ${JSON.stringify(expected)}`,
    );
  }
}

for (const file of files) {
  const mod = (await import(join(DIR, file))) as {
    name: string;
    run: (c: typeof check) => Promise<void>;
  };
  current = mod.name;
  const before = failed;
  try {
    await mod.run(check);
  } catch (error) {
    failed += 1;
    failures.push(`  ${mod.name}: threw ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`${failed === before ? 'ok  ' : 'FAIL'} ${mod.name}`);
}

if (failures.length) {
  console.log('\nfailures:');
  for (const f of failures) console.log(f);
}
console.log(`\n${files.length} suites, ${total} assertions, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
