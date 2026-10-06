import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensurePoolDirs, POOL_DIRS, writeJsonAtomic } from '../lib/pool/store.ts';
import { loadAllCandidates, loadCursors, loadPublishedUrls, loadSeen, markSeen, upsert } from '../lib/pool/pool.ts';
import { politeFetch } from '../lib/pool/fetcher.ts';
import { extractLinks, extractMarkdownLinks, isJunkUrl, looksLikeIndex, mainContentText, stripTracking, wordCount } from '../lib/pool/extract.ts';
import { SOURCES, type Source } from '../lib/pool/sources.ts';
import type { PoolCandidate } from '../lib/pool/schema.ts';

/**
 * Harvest: crawl allow-listed sources, write observations to `inbox/`.
 *
 * Idempotent by construction. A candidate is keyed by a hash of its
 * normalised URL, so re-running over the same page merges into the existing
 * file and bumps `seen_count` instead of creating a second copy. The cursor
 * state means a second run does not re-crawl pages already done, and the seen
 * ledger means an already-rejected URL never returns.
 *
 * This command only ever writes inside `.agents/pool/`. It cannot touch
 * `content/`.
 */

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  args.set(key!, value);
}

const DRY_RUN = args.get('dry-run') === 'true';
const LIMIT = Number(args.get('limit') ?? '0');
const ONLY = args.get('source');

const now = new Date().toISOString();

async function writeCandidate(candidate: PoolCandidate): Promise<'created' | 'updated' | 'dry'> {
  const path = join(POOL_DIRS[candidate.stage], `${candidate.id}.json`);
  if (DRY_RUN) return 'dry';
  const { access } = await import('node:fs/promises');
  const exists = await access(path).then(() => true, () => false);
  if (candidate.stage === 'rejected') {
    // Move out of whatever stage it was in, so a rejected candidate does not
    // linger in `inbox` and get picked up by the next stage.
    for (const dir of [POOL_DIRS.inbox, POOL_DIRS.candidate, POOL_DIRS.draft]) {
      await unlink(join(dir, `${candidate.id}.json`)).catch(() => {});
    }
  }
  await writeJsonAtomic(path, candidate);
  return exists ? 'updated' : 'created';
}

async function main(): Promise<void> {
  await ensurePoolDirs();

  const sources: Source[] = ONLY ? SOURCES.filter((s) => s.slug === ONLY) : SOURCES;
  if (sources.length === 0) {
    console.error(`no source matches "${ONLY}". Known: ${SOURCES.map((s) => s.slug).join(', ')}`);
    process.exit(1);
  }

  const candidates = await loadAllCandidates();
  const seen = await loadSeen();
  const cursors = await loadCursors();
  const published = await loadPublishedUrls();

  console.log(
    `harvest: ${sources.length} source(s), ${candidates.size} known candidate(s), ` +
      `${published.size} already published${DRY_RUN ? ', DRY RUN (no writes)' : ''}`,
  );

  const totals = { pages: 0, links: 0, new: 0, merged: 0, skipped: 0, junk: 0, index: 0, blocked: 0, notModified: 0, errors: 0 };
  const nextSeen = { ...seen };
  const nextCursors = { pages: { ...cursors.pages }, last_run: { ...cursors.last_run } };

  for (const source of sources) {
    const queue = [...source.urls].slice(0, source.maxPages || source.urls.length);
    let processed = 0;

    while (queue.length > 0 && processed < source.maxPages) {
      const pageUrl = queue.shift()!;
      // Resume: a page already fully processed is not re-fetched.
      if (cursors.pages[pageUrl] === pageUrl && cursors.last_run[source.slug]) {
        continue;
      }

      totals.pages += 1;
      const res = await politeFetch(pageUrl, { accept: 'text/html, text/plain, text/markdown;q=0.9, */*;q=0.5' });

      if (res.error === 'blocked-by-robots') {
        totals.blocked += 1;
        console.log(`  robots-disallow  ${pageUrl}`);
        nextCursors.pages[pageUrl] = pageUrl;
        continue;
      }
      if (res.notModified) {
        totals.notModified += 1;
        nextCursors.pages[pageUrl] = pageUrl;
        continue;
      }
      if (!res.ok) {
        totals.errors += 1;
        console.log(`  ${(res.error ?? 'error').padEnd(16)} ${pageUrl}`);
        nextCursors.pages[pageUrl] = pageUrl;
        continue;
      }

      // A GitHub README served raw is markdown, not HTML. Deciding by URL
      // rather than by content-type keeps this from mis-reading an HTML page
      // that happens to contain link syntax.
      const isMarkdown = /\.(md|markdown)\b|raw\.githubusercontent\.com/i.test(pageUrl);
      const links = isMarkdown ? extractMarkdownLinks(res.body) : extractLinks(res.body, res.finalUrl);
      const pageText = mainContentText(res.body, 2000);

      let kept = 0;
      for (const link of links) {
        if (LIMIT > 0 && totals.new + totals.merged >= LIMIT) break;
        totals.links += 1;

        // Shape check here rather than in `verify`: it costs no network, and
        // `verify` pays 1.5s of politeness delay per candidate. Harvesting a
        // site with a large shared sidebar otherwise queues hundreds of
        // fetches for links that were never going to survive.
        const shape = looksLikeIndex(link.url, link.title);
        if (shape.index) {
          totals.index += 1;
          continue;
        }

        const junk = isJunkUrl(link.url);
        if (junk.junk) {
          totals.junk += 1;
          continue;
        }

        const { clean } = stripTracking(link.url);
        if (published.has(clean)) {
          totals.skipped += 1;
          continue;
        }

        const decision = upsert(
          { url: clean, title: link.title, context: link.context, excerpt: pageText, source: source.slug, pageUrl },
          candidates,
          { urls: nextSeen.urls, titles: nextSeen.titles },
          now,
        );

        if (decision.action === 'skip') {
          totals.skipped += 1;
          continue;
        }

        // A candidate with almost no surrounding text cannot be described
        // honestly, so it never reaches the describer.
        if (wordCount(decision.candidate.context) < 4) {
          totals.junk += 1;
          continue;
        }

        candidates.set(decision.candidate.id, decision.candidate);
        await writeCandidate(decision.candidate);
        if (decision.action === 'new') totals.new += 1;
        else totals.merged += 1;
        kept += 1;
      }

      nextCursors.pages[pageUrl] = pageUrl;
      processed += 1;
      console.log(`  ok ${String(kept).padStart(3)} kept  ${pageUrl.slice(0, 90)}`);
    }

    nextCursors.last_run[source.slug] = now;
  }

  if (!DRY_RUN) {
    await writeJsonAtomic(join(POOL_DIRS.state, 'cursors.json'), nextCursors);
    await writeJsonAtomic(join(POOL_DIRS.state, 'seen.json'), nextSeen);
    await mkdir(POOL_DIRS.reports, { recursive: true });
    await writeJsonAtomic(join(POOL_DIRS.reports, 'harvest.json'), { at: now, totals, sources: sources.map((s) => s.slug) });
  }

  console.log(
    `harvest: ${totals.pages} page(s), ${totals.links} link(s) -> ${totals.new} new, ${totals.merged} merged, ` +
      `${totals.skipped} skipped, ${totals.junk} junk, ${totals.index} index-like, ${totals.blocked} robots-blocked, ${totals.errors} error(s)`,
  );
}

main().catch((error: Error) => {
  console.error(`harvest failed: ${error.message}`);
  process.exit(1);
});
