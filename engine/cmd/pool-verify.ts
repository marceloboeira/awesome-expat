import { z } from 'zod';
import { join } from 'node:path';
import { ensurePoolDirs, POOL_DIRS, writeJsonAtomic } from '../lib/pool/store.ts';
import { loadAllCandidates, writeStage } from '../lib/pool/pool.ts';
import { politeFetch } from '../lib/pool/fetcher.ts';
import { htmlToText, isJunkUrl, looksLikeIndex, mainContentText, wordCount } from '../lib/pool/extract.ts';
import { normaliseUrl } from '../lib/url.ts';
import type { PoolCandidate } from '../lib/pool/schema.ts';

/**
 * Verify that a candidate is a *resource* and not a navigation index.
 *
 * This stage exists because of an observed failure. Harvesting a section
 * index yields links like "Help", "Get involved", "Passports", "Travel
 * abroad" — the site's own navigation, one hop down. The classifier then
 * labels them with 1.00 confidence, because "Passports" fits `visa` perfectly.
 * Confidence measures category fit; it says nothing about whether the page is
 * a resource. Without this gate the pipeline confidently publishes a
 * directory of section headings.
 *
 * The signal is the target page's own content: an index page has almost no
 * prose, a real guide has a lot. Cheap, host-agnostic, and it does not depend
 * on guessing from the title.
 *
 * Dry-run by default.
 */

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [k, v = 'true'] = arg.replace(/^--/, '').split('=');
  args.set(k!, v);
}
const APPLY = args.get('apply') === 'true';
const MIN_WORDS = Number(args.get('min-words') ?? '150');
const LIMIT = Number(args.get('limit') ?? '0');

async function main(): Promise<void> {
  await ensurePoolDirs();
  const all = await loadAllCandidates();
  const todo = [...all.values()].filter((c) => c.stage === 'inbox' || c.stage === 'candidate');
  const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;

  console.log(
    `verify: ${batch.length} candidate(s), min ${MIN_WORDS} words${APPLY ? '' : '   [dry run]'}`,
  );
  const stats = { kept: 0, thin: 0, unreachable: 0, index: 0, blocked: 0, errors: 0 };
  const now = () => new Date().toISOString();

  for (const [i, candidate] of batch.entries()) {
    const tag = `[${i + 1}/${batch.length}] ${candidate.id}`;
    const url = normaliseUrl(candidate.url);
    if (!url) {
      stats.errors += 1;
      continue;
    }

    // Shape check first: it costs no network and rejects whole batches.
    const shape = looksLikeIndex(url, candidate.title);
    if (shape.index) {
      stats.index += 1;
      if (APPLY) {
        await writeStage({
          ...candidate,
          stage: 'rejected',
          rejected_reason: 'not-a-resource',
          notes: [...candidate.notes, 'index page: ' + shape.reason],
        });
      }
      continue;
    }

    const junk = isJunkUrl(url);
    if (junk.junk) {
      stats.index += 1;
      if (APPLY) {
        await writeStage({
          ...candidate,
          stage: 'rejected',
          rejected_reason: 'not-a-resource',
          notes: [...candidate.notes, `junk url: ${junk.reason}`],
        });
      }
      continue;
    }

    const res = await politeFetch(url, { accept: 'text/html, text/plain;q=0.9' });

    if (res.error === 'blocked-by-robots') {
      stats.blocked += 1;
      console.log(`  ${tag} robots-disallow  ${url.slice(0, 70)}`);
      continue;
    }
    if (!res.ok) {
      // Not our job to judge; `check-links` owns liveness. Leave the candidate
      // alone but surface the count.
      stats.unreachable += 1;
      console.log(`  ${tag} ${(res.error ?? 'error').padEnd(14)} ${url.slice(0, 62)}`);
      continue;
    }

    const text = mainContentText(res.body, 6000);
    const words = wordCount(text);

    if (words < MIN_WORDS) {
      stats.thin += 1;
      // A title-only page whose title is generic is an index, not a resource.
      const generic = /^(help|contact|about|home|index|overview|passports?|visas?|news|get involved|sign in|log in)$/i.test(
        candidate.title.trim(),
      );
      const reason = generic ? 'index-page' : 'content-thin';
      if (reason === 'index-page') stats.index += 1;
      console.log(`  ${tag} thin ${String(words).padStart(5)}w ${generic ? 'index ' : '     '}${url.slice(0, 58)}`);
      if (APPLY) {
        await writeStage({
          ...candidate,
          stage: 'rejected',
          rejected_reason: generic ? 'not-a-resource' : 'content-thin',
          notes: [...candidate.notes, `page has ${words} words, threshold ${MIN_WORDS}`],
        });
      }
      continue;
    }

    stats.kept += 1;
    console.log(`  ${tag} ok   ${String(words).padStart(5)}w ${url.slice(0, 62)}`);

    // The verified page text is the best excerpt we will ever have, and it is
    // the evidence a describer should use rather than a nav-adjacent blurb.
    if (APPLY) {
      const next: PoolCandidate = { ...candidate, excerpt: text.slice(0, 2000) };
      if (candidate.stage === 'inbox') next.stage = 'candidate';
      await writeStage(next);
    }
  }

  if (APPLY) {
    await writeJsonAtomic(join(POOL_DIRS.reports, 'verify.json'), { at: new Date().toISOString(), minWords: MIN_WORDS, stats });
  }
  console.log(
    `verify: ${stats.kept} kept, ${stats.thin} thin, ${stats.index} index-like, ` +
      `${stats.unreachable} unreachable, ${stats.blocked} robots-blocked, ${stats.errors} error(s)`,
  );
}

main().catch((error: Error) => {
  console.error(`verify failed: ${error.message}`);
  process.exit(1);
});
