import { join } from 'node:path';
import { ensurePoolDirs, POOL_DIRS, writeJsonAtomic } from '../lib/pool/store.ts';
import { loadAllCandidates, loadSeen, markSeen, validateForPromotion, writeStage, type PromotionCheck } from '../lib/pool/pool.ts';
import { slugifyTitle } from '../lib/url.ts';
import { CONTENT_DIR } from '../lib/content.ts';
import { repoRelative, writeYaml } from '../lib/write.ts';
import { join as joinPath } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

/**
 * Promote drafts from `.agents/pool/draft/` into `content/links/`.
 *
 * This is the only command in the repository that lets agent output reach
 * published content, and it is deliberately hard to use by accident:
 *
 *   - dry-run unless `--apply` is passed
 *   - refuses any candidate whose `description_verified` is still false, which
 *     only a human can set
 *   - re-runs the real `linkSchema` and the real cross-reference checks
 *   - writes exactly one file per link, at the canonical path
 *   - is idempotent: re-promoting an already-promoted URL is a no-op
 */

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [k, v = 'true'] = arg.replace(/^--/, '').split('=');
  args.set(k!, v);
}
const APPLY = args.get('apply') === 'true';
const LIMIT = Number(args.get('limit') ?? '0');

/**
 * Pick a filename for a promoted link.
 *
 * Two candidates can legitimately slugify to the same string ("ExpatWiki:
 * Germany" and "Expatwiki Germany"), and the filename is the link's id, so a
 * collision would silently overwrite or duplicate a published entry. The first
 * free slug wins; a collision appends the candidate's own hash, which is
 * stable, so re-promoting the same draft always lands on the same name.
 */
function uniqueSlug(country: string, category: string, base: string, poolId: string): string {
  const dir = joinPath(CONTENT_DIR, 'links', country, category);
  if (!existsSync(joinPath(dir, `${base}.yaml`))) return base;

  const disambiguated = `${base}-${poolId.slice(0, 6)}`;
  if (existsSync(joinPath(dir, `${disambiguated}.yaml`))) {
    // Deterministic on both candidate and title, so reaching this means the
    // same draft is being promoted twice under different URLs. Refuse rather
    // than overwrite the file that is already there.
    throw new Error(
      `slug collision: ${dir}/${disambiguated}.yaml already exists. ` +
        `Rename the existing file or reject this candidate.`,
    );
  }
  return disambiguated;
}

async function main(): Promise<void> {
  await ensurePoolDirs();
  const all = await loadAllCandidates();
  const drafts = [...all.values()].filter((c) => c.stage === 'draft');
  const batch = LIMIT > 0 ? drafts.slice(0, LIMIT) : drafts;

  console.log(
    `promote: ${batch.length} draft(s)${APPLY ? '   APPLY — writing to content/' : '   [dry run — pass --apply to write]'}`,
  );
  if (batch.length === 0) return;

  const stats = { promoted: 0, skipped: 0, blocked: 0 };
  const seen = await loadSeen();

  for (const candidate of batch) {
    const label = `${candidate.id} ${candidate.title.slice(0, 46)}`;

    let check: PromotionCheck;
    try {
      check = await validateForPromotion(candidate);
    } catch (error) {
      // One bad candidate must not abandon the rest of the batch.
      stats.blocked += 1;
      console.log(`  BLOCKED ${label}`);
      console.log(`            ${(error as Error).message}`);
      continue;
    }

    if (!check.ok) {
      stats.blocked += 1;
      console.log(`  BLOCKED ${label}`);
      for (const error of check.errors) console.log(`            ${error}`);
      continue;
    }

    const link = check.preview!;
    const country = link.country as string;
    const category = link.category as string;

    // Idempotency: a URL already in the seen ledger as promoted, or already
    // present in content/, is skipped rather than written a second time. Checked
    // before the slug, because a collision at this point is a re-promotion
    // rather than a genuine name conflict.
    if (seen.urls[candidate.url]?.state === 'promoted') {
      stats.skipped += 1;
      console.log(`  skip (already promoted) ${label}`);
      continue;
    }

    // The filename IS the link's id (content.ts reads it off the path), so it
    // must follow the corpus convention: a human-readable kebab-case slug. This
    // used to be `${link.id}.yaml`, i.e. the candidate's 12-hex SHA-1 prefix --
    // an identifier that appears nowhere else in `content/`, and which would
    // have surfaced as an opaque segment in every route derived from a filename.
    let slug: string;
    try {
      slug = uniqueSlug(country, category, slugifyTitle(link.title as string), candidate.id);
    } catch (error) {
      stats.blocked += 1;
      console.log(`  BLOCKED ${label}`);
      console.log(`            ${(error as Error).message}`);
      continue;
    }
    const path = joinPath(CONTENT_DIR, 'links', country, category, `${slug}.yaml`);

    if (APPLY) {
      await mkdir(joinPath(CONTENT_DIR, 'links', country, category), { recursive: true });
      await writeYaml(repoRelative(path), link as never);
      const next = markSeen(seen, candidate, 'promoted', undefined, new Date().toISOString());
      seen.urls = next.urls;
      seen.titles = next.titles;
      // The draft is retired so it cannot be promoted twice.
      await writeStage({ ...candidate, stage: 'inbox' });
    }

    stats.promoted += 1;
    console.log(`  ${APPLY ? 'promoted' : 'would promote'} ${country}/${category}  ${label}`);
  }

  if (APPLY) {
    await writeJsonAtomic(join(POOL_DIRS.state, 'seen.json'), { urls: seen.urls, titles: seen.titles });
    await writeJsonAtomic(join(POOL_DIRS.reports, 'promote.json'), { at: new Date().toISOString(), stats });
    console.log('\npromote: re-run `make check` and `make export` to publish the new pages.');
  }
  console.log(`promote: ${stats.promoted} promoted, ${stats.skipped} skipped, ${stats.blocked} blocked`);
}

main().catch((error: Error) => {
  console.error(`promote failed: ${error.message}`);
  process.exit(1);
});
