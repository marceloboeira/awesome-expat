import { z } from 'zod';

/**
 * Pool candidates are NOT links. They are quarantined observations.
 *
 * Nothing in `.agents/pool/` may be read by `export-markdown.ts` or by the
 * Astro build. The only crossing point is `pool-promote`, which must pass a
 * candidate through the real `linkSchema` before writing to `content/`.
 *
 * That separation is the whole point: a 1B model hallucinating a URL can fill
 * the pool, but it cannot publish anything.
 */

export const POOL_STAGES = ['inbox', 'candidate', 'draft', 'rejected'] as const;
export type PoolStage = (typeof POOL_STAGES)[number];

export const POOL_REJECT_REASONS = [
  'duplicate', // matched an existing link, in the pool, or in the seen ledger
  'not-a-resource', // listicles, news, homepages, social, login walls
  'low-confidence', // classifier below threshold
  'no-country', // could not place it, and it is not global
  'unreachable', // did not return 2xx on two attempts
  'content-thin', // too little text to describe honestly
  'manually-rejected', // a human said no
] as const;
export type PoolRejectReason = (typeof POOL_REJECT_REASONS)[number];

export const poolCandidateSchema = z.object({
  /** Stable id: sha1 of the normalised URL, first 12 hex chars. */
  id: z.string().regex(/^[a-f0-9]{12}$/),

  /** Where this observation came from: source slug + page URL. */
  discovered_from: z.object({
    source: z.string().min(1),
    page_url: z.string().url(),
  }),

  /** Normalised form; the dedup key. Raw URL kept for auditability. */
  url: z.string().url(),
  raw_url: z.string().url(),

  /** Best title seen across all pages that linked here. */
  title: z.string().min(1),

  /** Verbatim anchor/context text around the link, capped. */
  context: z.string().max(400).default(''),

  /** Page text the harvester stored, used for the LLM. Capped. */
  excerpt: z.string().max(2000).default(''),

  stage: z.enum(POOL_STAGES).default('inbox'),

  // ---- classifier output ------------------------------------------------
  classification: z
    .object({
      country: z.string().min(2),
      category: z.string().min(2),
      scopes: z.array(z.string()).default([]),
      roles: z.array(z.string()).default([]),
      confidence: z.number().min(0).max(1),
      rationale: z.string().max(300).default(''),
      model: z.string(),
    })
    .optional(),

  // ---- describer output -------------------------------------------------
  // Always `false` from the agent. Only a human (or an explicit promotion
  // override) may set this, and `pool-promote` refuses to promote a link
  // whose description is not verified while editing content/ by hand.
  description: z
    .object({
      text: z.string().min(10).max(400),
      model: z.string(),
      generated_at: z.string(),
    })
    .optional(),
  /**
   * Must be a plain boolean, not `z.literal(false)`.
   *
   * The agent pipeline (`pool-describe`) always writes `false`, and a human is
   * the only thing that may set it to `true`. This field was `literal(false)`,
   * which made `true` unrepresentable: a human editing a draft by hand produced
   * a file that `loadAllCandidates` rejected via `.parse`, so the candidate was
   * dropped with a "skipping unreadable candidate" warning, and
   * `validateForPromotion` -- which requires `true` -- could never be reached.
   * The quarantine was not fail-safe, it was fail-closed with no exit: nothing
   * could ever be promoted.
   */
  description_verified: z.boolean().default(false),

  // ---- provenance -------------------------------------------------------
  first_seen: iso(),
  last_seen: iso(),
  seen_count: z.number().int().min(1).default(1),
  rejected_reason: z.enum(POOL_REJECT_REASONS).optional(),
  notes: z.array(z.string()).default([]),
});

export type PoolCandidate = z.infer<typeof poolCandidateSchema>;

function iso() {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/, {
      message: 'expected a full ISO-8601 timestamp',
    });
}

/**
 * The harvest cursor, so a re-run resumes instead of re-crawling.
 * Persisted as `.agents/pool/state/cursors.json`.
 */
export const cursorSchema = z.object({
  /** source slug -> last page URL fully processed (null = not started). */
  pages: z.record(z.string(), z.string().url().nullable()),
  /** source slug -> ISO timestamp of last run. */
  last_run: z.record(z.string(), iso()),
});
export type Cursors = z.infer<typeof cursorSchema>;

/**
 * The seen ledger. A URL that has been rejected once is never re-proposed,
 * which is what stops a bad harvest from looping forever.
 */
export const seenSchema = z.object({
  /** normalised url -> { rejected reason, or promoted link id } */
  urls: z.record(
    z.string(),
    z.object({
      state: z.enum(['rejected', 'promoted', 'duplicate']),
      reason: z.enum(POOL_REJECT_REASONS).optional(),
      at: iso(),
      pool_id: z.string().optional(),
    }),
  ),
  /** Titles already known, lowercased, to catch cross-domain duplicates. */
  titles: z.record(z.string(), iso()),
});
export type Seen = z.infer<typeof seenSchema>;

export const emptySeen = (): Seen => ({ urls: {}, titles: {} });
export const emptyCursors = (): Cursors => ({ pages: {}, last_run: {} });
