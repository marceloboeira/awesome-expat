import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * All pool IO lives here so that the rest of the pool code can stay pure and
 * testable: given a candidate, produce the next candidate. This module is the
 * only thing that touches `.agents/pool/`.
 *
 * `.agents/` is gitignored, which is what makes the quarantine meaningful —
 * nothing the agent writes can reach the published site.
 */

export const POOL_ROOT = '.agents/pool';
export const CONTENT_ROOT = 'content';

export const POOL_DIRS = {
  root: POOL_ROOT,
  inbox: join(POOL_ROOT, 'inbox'),
  candidate: join(POOL_ROOT, 'candidate'),
  draft: join(POOL_ROOT, 'draft'),
  rejected: join(POOL_ROOT, 'rejected'),
  state: join(POOL_ROOT, 'state'),
  reports: join(POOL_ROOT, 'reports'),
} as const;

export type PoolDir = keyof typeof POOL_DIRS;

/** Creates the pool tree. Safe to call every run. */
export async function ensurePoolDirs(): Promise<void> {
  for (const dir of Object.values(POOL_DIRS)) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * The stable identity of a candidate.
 *
 * Deliberately *not* derived from the title: the same resource linked from
 * three pages has three titles and one URL. Title-based ids would create three
 * candidates and then require dedup to merge them.
 */
export function candidateId(normalisedUrl: string): string {
  return createHash('sha1').update(normalisedUrl).digest('hex').slice(0, 12);
}

/** Title key for the cross-domain seen ledger. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads one JSON file, returning `fallback` when it does not exist.
 *
 * Validating the fallback through the schema is not enough: a corrupt or
 * hand-mangled state file must fail loudly rather than silently reset the
 * seen ledger and re-propose everything that was rejected last week.
 */
export async function readJson<T>(
  path: string,
  parse: (raw: unknown) => T,
  fallback: () => T,
): Promise<T> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return fallback();
  }
  try {
    return parse(JSON.parse(text));
  } catch (error) {
    throw new Error(
      `${path} exists but is unreadable. Refusing to reset pool state, which ` +
        `would re-propose every URL ever rejected.\n  ${(error as Error).message}\n` +
        `  Fix or delete the file, then re-run.`,
    );
  }
}

/**
 * Atomic write: temp file then rename.
 *
 * A half-written seen ledger is worse than no ledger — the next run would
 * treat rejected URLs as new. Rename is atomic within a filesystem, so a
 * reader never observes a partial file.
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

async function rename(from: string, to: string): Promise<void> {
  const { rename: rn } = await import('node:fs/promises');
  await rn(from, to);
}
