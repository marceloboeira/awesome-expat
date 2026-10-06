import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { candidateId, titleKey, POOL_DIRS, readJson, writeJsonAtomic } from './store.ts';
import {
  poolCandidateSchema,
  seenSchema,
  cursorSchema,
  emptySeen,
  emptyCursors,
  type PoolCandidate,
  type PoolRejectReason,
  type Seen,
  type Cursors,
} from './schema.ts';
import { cleanTitle } from './extract.ts';
import { normaliseUrl } from '../url.ts';
import { linkSchema } from '../schema.ts';
import { loadContent } from '../content.ts';

const STAGE_DIR: Record<string, string> = {
  inbox: POOL_DIRS.inbox,
  candidate: POOL_DIRS.candidate,
  draft: POOL_DIRS.draft,
  rejected: POOL_DIRS.rejected,
};

export interface Observation {
  url: string;
  title: string;
  context: string;
  excerpt: string;
  source: string;
  pageUrl: string;
}

export type UpsertDecision =
  | { action: 'new'; candidate: PoolCandidate }
  | { action: 'merge'; candidate: PoolCandidate }
  | { action: 'skip'; reason: string };

/**
 * Folds one observation into the pool. Pure: given the same observation,
 * candidate map, seen ledger and `now`, the result is identical. `now` is a
 * parameter rather than a call to `new Date()` precisely so that idempotency
 * is testable.
 */
export function upsert(
  observation: Observation,
  existing: ReadonlyMap<string, PoolCandidate>,
  seen: Seen,
  now: string,
): UpsertDecision {
  const normalised = normaliseUrl(observation.url);
  if (!normalised) return { action: 'skip', reason: 'url will not normalise' };

  const id = candidateId(normalised);
  const title = cleanTitle(observation.title);

  // The seen ledger is consulted before the candidate store: a URL rejected
  // once must never return, even if a stale candidate file survived in a
  // different stage directory.
  const prior = seen.urls[normalised];
  if (prior?.state === 'rejected') return { action: 'skip', reason: `previously rejected (${prior.reason})` };
  if (prior?.state === 'promoted') return { action: 'skip', reason: 'already promoted' };

  const found = existing.get(id);
  if (found) {
    if (found.stage === 'rejected') return { action: 'skip', reason: 'candidate already rejected (' + found.rejected_reason + ')' };
    return {
      action: 'merge',
      candidate: {
        ...found,
        // Longest context wins: a link mentioned in a sentence is more
        // informative than one listed bare in a bullet list.
        //
        // Both must be re-sliced. Taking the longer value verbatim let an
        // oversized excerpt through on the merge path, which the schema then
        // rejected on the next read -- so a candidate written once could not be
        // read back. The cap is enforced here, where the value is chosen.
        context: observation.context.length > found.context.length ? observation.context.slice(0, 400) : found.context,
        excerpt: observation.excerpt.length > found.excerpt.length ? observation.excerpt.slice(0, 2000) : found.excerpt,
        last_seen: now,
        seen_count: found.seen_count + 1,
      },
    };
  }

  return {
    action: 'new',
    candidate: poolCandidateSchema.parse({
      id,
      discovered_from: { source: observation.source, page_url: observation.pageUrl },
      url: normalised,
      raw_url: observation.url,
      title,
      context: observation.context.slice(0, 400),
      excerpt: observation.excerpt.slice(0, 2000),
      stage: 'inbox',
      description_verified: false,
      first_seen: now,
      last_seen: now,
      seen_count: 1,
      notes: [],
    }),
  };
}

export function reject(
  candidate: PoolCandidate,
  reason: PoolRejectReason,
  note: string,
  now: string,
): PoolCandidate {
  return {
    ...candidate,
    stage: 'rejected',
    rejected_reason: reason,
    notes: [...candidate.notes, `${now.slice(0, 10)} ${note}`].slice(-10),
    last_seen: now,
  };
}

export function advance(candidate: PoolCandidate, stage: PoolCandidate['stage']): PoolCandidate {
  return { ...candidate, stage };
}

/**
 * Moves a candidate to the directory for its stage, removing any copy left in
 * another stage dir.
 *
 * A candidate that is rejected while still sitting in `inbox` would otherwise
 * be picked up again by the next stage, so the stale copy is unlinked rather
 * than left behind.
 */
export async function writeStage(candidate: PoolCandidate): Promise<void> {
  const { unlink } = await import('node:fs/promises');
  for (const dir of [POOL_DIRS.inbox, POOL_DIRS.candidate, POOL_DIRS.draft]) {
    await unlink(join(dir, candidate.id + '.json')).catch(() => {});
  }
  await writeJsonAtomic(join(POOL_DIRS[candidate.stage], candidate.id + '.json'), candidate);
}

/** Records a rejection in the ledger so the URL is never proposed again. */
export function markSeen(seen: Seen, candidate: PoolCandidate, state: 'rejected' | 'promoted' | 'duplicate', reason?: PoolRejectReason, now = candidate.last_seen): Seen {
  const urls = { ...seen.urls, [candidate.url]: { state, reason, at: now, pool_id: candidate.id } };
  const titles = { ...seen.titles };
  const key = titleKey(candidate.title);
  // A title seen more than once is weak evidence of a cross-domain duplicate.
  if (key && !titles[key]) titles[key] = now;
  return { urls, titles };
}

export async function loadAllCandidates(): Promise<Map<string, PoolCandidate>> {
  const map = new Map<string, PoolCandidate>();
  // Order matters: `rejected` is read last so a re-staged file wins over a
  // stale copy left in an earlier stage directory.
  for (const stage of ['draft', 'candidate', 'inbox', 'rejected']) {
    let files: string[];
    try {
      files = await readdir(STAGE_DIR[stage]!);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const parsed = poolCandidateSchema.parse(JSON.parse(await readFile(join(STAGE_DIR[stage]!, file), 'utf8')));
        map.set(parsed.id, parsed);
      } catch (error) {
        // One corrupt file must not abort the run; report it and continue.
        console.warn(`  ! skipping unreadable candidate ${file}: ${(error as Error).message.slice(0, 90)}`);
      }
    }
  }
  return map;
}

export async function loadSeen(): Promise<Seen> {
  return readJson(join(POOL_DIRS.state, 'seen.json'), (raw) => seenSchema.parse(raw), emptySeen);
}

export async function loadCursors(): Promise<Cursors> {
  return readJson(join(POOL_DIRS.state, 'cursors.json'), (raw) => cursorSchema.parse(raw), emptyCursors);
}

/** URLs already published in `content/`, so the pool cannot re-propose them. */
export async function loadPublishedUrls(): Promise<Set<string>> {
  const { links } = await loadContent();
  const out = new Set<string>();
  for (const { data } of links) {
    const clean = normaliseUrl(data.url);
    if (clean) out.add(clean);
  }
  return out;
}

export interface PromotionCheck {
  ok: boolean;
  errors: string[];
  /** The exact object that would be written, for a dry-run diff. */
  preview: Record<string, unknown> | null;
}

/**
 * The gate between the pool and `content/`.
 *
 * Every check here is a *refusal* rule. The point of the quarantine is that
 * agent output is not trustworthy, so promotion requires a human to have set
 * `description_verified: true` and requires the real `linkSchema` to accept the
 * result. A candidate that fails any check is not written.
 */
export async function validateForPromotion(candidate: PoolCandidate): Promise<PromotionCheck> {
  const errors: string[] = [];
  const c = candidate.classification;

  if (!c) return { ok: false, errors: ['not classified'], preview: null };
  if (c.confidence < 0.6) errors.push(`confidence ${c.confidence} below the 0.6 gate`);
  if (!candidate.description) errors.push('no description drafted');
  // The single most important rule: the agent can never set this itself.
  if (!candidate.description_verified) errors.push('description_verified is false — a human must edit the candidate and set it true');

  if (!normaliseUrl(candidate.url)) errors.push(`url will not normalise: ${candidate.url}`);

  const content = await loadContent();
  if (!content.countries.has(c.country)) errors.push(`unknown country: ${c.country}`);
  if (!content.categories.has(c.category)) errors.push(`unknown category: ${c.category}`);
  for (const scope of c.scopes) if (!content.countries.has(scope)) errors.push(`unknown scope: ${scope}`);
  for (const role of c.roles) if (!content.roles.has(role)) errors.push(`unknown role: ${role}`);

  const clean = normaliseUrl(candidate.url);
  if (clean) {
    const clash = content.links.find(({ data }) => normaliseUrl(data.url) === clean);
    // `clash.data.id` was a pre-existing type error: `Link` has no `id` field
    // because the id is the *filename*. `clash.file` is both correct and more
    // useful in a terminal -- it is the thing to open.
    if (clash) errors.push(`url already published as ${clash.file}`);
  }

  // No `id` key. `linkSchema` is `.strict()` and does not declare one: a link's
  // identity is its *filename* (`slugOf()` in content.ts reads it off the path),
  // so a content file carrying `id:` was always invalid. This object used to
  // set `id: candidate.id`, which made `linkSchema.safeParse` fail with
  // "unrecognized key" for every candidate and left `preview: null` -- so even
  // with `description_verified` fixed, nothing could be written.
  const link = {
    title: candidate.title,
    url: candidate.url,
    country: c.country,
    scopes: c.scopes,
    category: c.category,
    roles: c.roles,
    description: candidate.description?.text ?? 'x'.repeat(10),
    // True here means a human set it, which is the whole point of the gate.
    description_verified: candidate.description_verified,
    contributors: [],
    added_at: candidate.first_seen.slice(0, 10),
    last_checked: null,
    featured: false,
    tags: [],
  };

  const parsed = linkSchema.safeParse(link);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${issue.path.join('.') || 'link'}: ${issue.message}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    preview: parsed.success ? (parsed.data as unknown as Record<string, unknown>) : null,
  };
}
