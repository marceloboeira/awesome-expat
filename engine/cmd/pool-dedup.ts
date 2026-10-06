import { join } from 'node:path';
import { z } from 'zod';
import { ensurePoolDirs, POOL_DIRS, titleKey, writeJsonAtomic } from '../lib/pool/store.ts';
import { loadAllCandidates, loadSeen, markSeen, reject, writeStage } from '../lib/pool/pool.ts';
import { cosine, embed, isServerUp, listModels, MODELS } from '../lib/pool/ollama.ts';
import { normaliseUrl } from '../lib/url.ts';
import { loadContent } from '../lib/content.ts';
import type { PoolCandidate } from '../lib/pool/schema.ts';

/**
 * Dedup. Three passes, cheapest first:
 *
 *   1. exact    -- same normalised URL as a published link
 *   2. title    -- same normalised title, catches one resource on two domains
 *   3. semantic -- bge-m3 cosine over title+context, catches the paraphrase
 *
 * Order matters: the first two are free and exact, so the embedding call -- the
 * only slow, model-dependent step -- runs only on what survives.
 *
 * Vectors are cached in `state/vectors.json` keyed by a hash of the embedded
 * text. Without that, every run re-embeds all 67 published links, which turns a
 * 2-second check into a 2-minute one.
 *
 * Dry-run by default. `--apply` is what actually rejects.
 */

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [k, v = 'true'] = arg.replace(/^--/, '').split('=');
  args.set(k!, v);
}
const THRESHOLD = Number(args.get('threshold') ?? '0.92');
const APPLY = args.get('apply') === 'true';
const SEMANTIC = args.get('no-semantic') !== 'true';
const LIMIT = Number(args.get('limit') ?? '0');

const vectorCacheSchema = z.record(z.string(), z.array(z.number()));
type VectorCache = z.infer<typeof vectorCacheSchema>;

const key = (text: string) => `${MODELS.embed}:${text.length}:${text.slice(0, 40)}`;

async function loadCache(): Promise<VectorCache> {
  try {
    const { readFile } = await import('node:fs/promises');
    return vectorCacheSchema.parse(JSON.parse(await readFile(join(POOL_DIRS.state, 'vectors.json'), 'utf8')));
  } catch {
    return {};
  }
}

async function embedCached(text: string, cache: VectorCache): Promise<number[]> {
  const k = key(text);
  const hit = cache[k];
  if (hit) return hit;
  const vec = await embed(MODELS.embed, text);
  cache[k] = vec;
  return vec;
}

/** Title+context is the embedding input; the title alone is far too generic. */
function embedText(c: { title: string; context: string }): string {
  return `${c.title}. ${c.context}`.slice(0, 500);
}

async function main(): Promise<void> {
  await ensurePoolDirs();

  if (SEMANTIC && !(await isServerUp())) {
    console.error('dedup: Ollama is not running and the semantic pass needs it.');
    console.error('  ollama serve   — or run the exact and title passes only: --no-semantic');
    process.exit(1);
  }

  const candidates = await loadAllCandidates();
  const { links } = await loadContent();

  const publishedUrls = new Set<string>();
  for (const { data } of links) {
    const clean = normaliseUrl(data.url);
    if (clean) publishedUrls.add(clean);
  }

  const seen = await loadSeen();
  const cache = await loadCache();
  const stats = { exact: 0, title: 0, semantic: 0, kept: 0, errors: 0 };
  const live = [...candidates.values()].filter((c) => c.stage !== 'rejected');

  // The semantic baseline: published links plus candidates kept so far.
  const baseline: { id: string; vec: number[] }[] = [];
  if (SEMANTIC) {
    process.stdout.write(`dedup: embedding ${links.length} published link(s)...`);
    for (const { data } of links) {
      try {
        baseline.push({ id: `content/${data.id}`, vec: await embedCached(`${data.title}. ${data.description}`, cache) });
      } catch (error) {
        stats.errors += 1;
        console.warn(`\n  ! ${data.id}: ${(error as Error).message.slice(0, 70)}`);
      }
    }
    console.log(' done');
  }

  const publishedTitles = new Set(links.map(({ data }) => titleKey(data.title)).filter((t) => t.length > 6));

  for (const candidate of live) {
    // Pass 1: exact URL already published.
    const clean = normaliseUrl(candidate.url);
    if (clean && publishedUrls.has(clean)) {
      await drop(candidate, 'url already in content/', stats, 'exact');
      continue;
    }

    // Pass 2: title collision, against published links or an earlier candidate.
    const tk = titleKey(candidate.title);
    if (tk.length > 6) {
      if (publishedTitles.has(tk)) {
        await drop(candidate, 'title matches a published link', stats, 'title');
        continue;
      }
      const clash = live.find((c) => c.id !== candidate.id && c.stage !== 'rejected' && titleKey(c.title) === tk);
      if (clash) {
        await drop(candidate, `same title as ${clash.id}`, stats, 'title');
        continue;
      }
    }

    // Pass 3: semantic near-duplicate.
    if (SEMANTIC) {
      const vec = await embedCached(embedText(candidate), cache);
      let best = 0;
      let against = '';
      for (const other of baseline) {
        const score = cosine(vec, other.vec);
        if (score > best) {
          best = score;
          against = other.id;
        }
      }
      if (best >= THRESHOLD) {
        await drop(candidate, `cosine ${best.toFixed(3)} with ${against}`, stats, 'semantic');
        continue;
      }
      baseline.push({ id: candidate.id, vec });
    }

    stats.kept += 1;
  }

  if (APPLY) {
    await writeJsonAtomic(join(POOL_DIRS.state, 'vectors.json'), cache);
    await writeJsonAtomic(
      join(POOL_DIRS.state, 'seen.json'),
      { urls: seen.urls, titles: { ...seen.titles } },
    );
  }

  console.log(
    `dedup: ${stats.exact} exact + ${stats.title} title + ${stats.semantic} semantic rejected, ` +
      `${stats.kept} kept, ${stats.errors} embed error(s)` +
      (APPLY ? '' : '   [dry run — pass --apply to reject]'),
  );

  async function drop(c: PoolCandidate, why: string, s: typeof stats, kind: 'exact' | 'title' | 'semantic'): Promise<void> {
    s[kind] += 1;
    const now = new Date().toISOString();
    if (APPLY) {
      await writeStage(reject(c, 'duplicate', why, now));
      // The ledger is what stops this URL being proposed again on the next
      // harvest, so it is updated in the same step as the rejection.
      const next = markSeen(seen, c, 'duplicate', 'duplicate', now);
      seen.urls = next.urls;
      seen.titles = next.titles;
    } else {
      console.log(`  would reject ${c.id} ${c.title.slice(0, 50)} (${why})`);
    }
    if (LIMIT > 0 && stats.exact + stats.title + stats.semantic >= LIMIT) return;
  }
}

main().catch((error: Error) => {
  console.error(`dedup failed: ${error.message}`);
  process.exit(1);
});
