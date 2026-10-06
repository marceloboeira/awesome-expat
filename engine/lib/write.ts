import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { ROOT } from './content.ts';

/**
 * Write a YAML file deterministically.
 *
 * Determinism matters more than it looks: `make check` regenerates docs/ and
 * README.md and fails on a diff, so any nondeterminism in key order or
 * formatting would fail CI on an unchanged tree.
 */

/** Drop empty arrays/objects so files stay clean and diffs stay small. */
function prune<T>(value: T): unknown {
  if (Array.isArray(value)) {
    const kept = value.map(prune).filter((item) => item !== undefined);
    return kept.length ? kept : undefined;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const pruned = prune(item);
      if (pruned !== undefined) out[key] = pruned;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

export interface WriteOptions {
  /** Skip the write if the file already exists. Used by `seed`. */
  skipIfExists?: boolean;
  /** Do not create parent directories. */
  flat?: boolean;
}

export async function writeYaml(relPath: string, data: unknown, options: WriteOptions = {}): Promise<boolean> {
  const abs = join(ROOT, relPath);
  if (options.skipIfExists) {
    const { access } = await import('node:fs/promises');
    try {
      await access(abs);
      return false;
    } catch {
      /* not there, fall through and write */
    }
  }

  const body = stringifyYaml(prune(data) as never, {
    indent: 2,
    lineWidth: 0,
    // Quote nothing; slash/colon-safe strings are unquoted for readable diffs.
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  });

  if (!options.flat) await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, `---\n${body}`, 'utf8');
  return true;
}

export function repoRelative(absPath: string): string {
  return relative(ROOT, absPath).split(sep).join('/');
}

export { ROOT };
