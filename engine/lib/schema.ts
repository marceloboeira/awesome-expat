import { z } from 'zod';

/**
 * Single source of truth for every content shape in this repo.
 *
 * Imported by:
 *   - engine/cmd/*.ts        (CLI validation via `make check`)
 *   - src/content.config.ts  (Astro content collections)
 *
 * If a field is not modelled here it does not exist. Adding a field means
 * adding it here first; both consumers pick it up automatically.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** ISO 3166-1 alpha-2, lowercase. Used for flags and canonical URLs. */
export const countryCodeSchema = z
  .string()
  .length(2)
  .regex(/^[a-z]{2}$/, 'must be a lowercase ISO 3166-1 alpha-2 code');

/** Lowercase kebab-case identifier, used as a URL segment and a filename. */
export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case: a-z, 0-9, single dashes');

/**
 * Canonicalised https URL.
 *
 * Normalised by `normaliseUrl()` at write time and re-checked here, so a
 * hand-edited file cannot smuggle in `http://`, a tracking suffix, or a
 * `www.` variant that collides with an existing entry.
 */
export const urlSchema = z
  .string()
  .url('must be a valid URL')
  .refine((value) => value.startsWith('https://'), 'must use https://')
  .refine(
    (value) => !TRACKING_PARAM_PATTERN.test(value),
    'must not contain tracking parameters — run the URL through normaliseUrl()',
  );

/** A GitHub username, with or without the `@` sigil. */
export const githubUserSchema = z
  .string()
  .regex(/^@?[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i, 'must be a GitHub username')
  .transform((value) => value.replace(/^@/, '').toLowerCase());

/**
 * An ISO calendar date, `YYYY-MM-DD`.
 *
 * Accepts a `Date` as well as a string, because the same YAML files are read by
 * two parsers that disagree about this: the `yaml` package (used by the CLI)
 * leaves `2026-09-29` as a string, while Astro's glob loader runs it through
 * `js-yaml`, which resolves it to a `Date` at midnight UTC. Without this
 * normalisation the files validate for `make check` and then fail the site
 * build, which is a genuinely confusing failure to debug.
 *
 * A `Date` is converted via `toISOString()`, which is safe here only because
 * YAML dates carry no time or offset -- the result is midnight UTC, so there is
 * no local-timezone drift.
 */
export const dateSchema = z.preprocess((value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString().slice(0, 10);
  }
  return value;
}, z.iso.date('must be an ISO date (YYYY-MM-DD)'));

/** Today, as `YYYY-MM-DD`. Evaluated once at module load. */
const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Block a date in the future. `added_at`/`last_checked`/`published` are
 * editorial facts; a future value is always a typo, and it silently breaks
 * the "newest first" ordering everywhere it is used.
 */
const notInFuture = (label: string) =>
  dateSchema.refine((value) => value <= TODAY, `${label} must not be in the future`);

/**
 * Ad-tracking query parameters. Kept in sync with `TRACKING_PARAMS` in
 * `engine/lib/url.ts`, which is the code that actually strips them.
 */
const TRACKING_PARAM_PATTERN =
  /[?&](utm_[^=&#]*|ref_[^=&#]*|mc_[ce]id|ref|referrer|source|fbclid|gclid|msclkid|igshid|_ga|yclid|si)=/i;

// ---------------------------------------------------------------------------
// Registry entries — one YAML file each
// ---------------------------------------------------------------------------

export const regionSchema = z.enum(['europe', 'asia', 'africa', 'americas', 'oceania', 'middle-east']);

export const countrySchema = z
  .object({
    name: z.string().min(2).max(64),
    code: countryCodeSchema,

    /**
     * Optional because exactly one registry entry opts out: the `global`
     * pseudo-country, which holds resources that apply everywhere
     * (Numbeo, Wise, Duolingo, Airbnb).
     *
     * Without it those links have nowhere to live. Filing them under a real
     * country would be a lie, and duplicating them across 150 countries would
     * guarantee drift.
     */
    region: regionSchema.optional(),

    /** True only for the `global` pseudo-country. */
    global: z.boolean().default(false),

    /** Alternative spellings and legacy URLs, so old links keep resolving. */
    aliases: z.array(z.string()).default([]),
    /** One-line summary shown on the country page and in the map tooltip. */
    description: z.string().max(200).optional(),
  })
  .strict()
  .superRefine((country, ctx) => {
    if (country.global && country.region) {
      ctx.addIssue({ code: 'custom', message: 'the global pseudo-country must not set a region', path: ['region'] });
    }
    if (!country.global && !country.region) {
      ctx.addIssue({ code: 'custom', message: 'region is required unless global is true', path: ['region'] });
    }
  });

export const categorySchema = z
  .object({
    name: z.string().min(2).max(48),
    description: z.string().min(10).max(200),
    /** Sort weight on country pages. Lower comes first. */
    order: z.number().int().min(0).max(199).default(50),
  })
  .strict();

export const groupSchema = z
  .object({
    name: z.string().min(2).max(48),
    description: z.string().min(10).max(240),
    /** Country slugs. Validated against the country registry at build time. */
    countries: z.array(slugSchema).min(2),
  })
  .strict();

export const roleSchema = z
  .object({
    name: z.string().min(2).max(48),
    description: z.string().min(10).max(200),
  })
  .strict();

export const authorSchema = z
  .object({
    name: z.string().min(1).max(80),
    handle: slugSchema,
    github: githubUserSchema.optional(),
    bio: z.string().max(300).optional(),
  })
  .strict();

export type Country = z.infer<typeof countrySchema>;
export type Category = z.infer<typeof categorySchema>;
export type Group = z.infer<typeof groupSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Author = z.infer<typeof authorSchema>;

// ---------------------------------------------------------------------------
// Link — the primary content type
// ---------------------------------------------------------------------------

export const linkSchema = z
  .object({
    title: z.string().min(3).max(120),

    /**
     * Canonical target. Enforced to be https and free of tracking params;
     * `validate` additionally flags any URL that is not already in its
     * normalised form, and rejects two files that normalise to the same URL.
     */
    url: urlSchema,

    /**
     * Country the link is filed under. Must match the directory name; the
     * validator enforces that so a file can never live in the wrong place.
     */
    country: slugSchema,

    /**
     * Every country this link is useful for, including `country` itself.
     *
     * A single directory means a link relevant to five countries would be
     * duplicated five times and the five copies would drift. Instead the file
     * lives once under its primary country and lists the rest here; the site
     * surfaces it on every listed country page.
     *
     * e.g. Actero (a EUR 4,000/mo remote-work platform for Germany, Italy,
     * France, Spain and the UK) is one file with
     * `scopes: [de, it, fr, es, gb]`.
     */
    scopes: z.array(slugSchema).min(1).optional(),

    category: slugSchema,

    /**
     * Job roles this link is specifically for. An empty list (the default)
     * means "useful to everyone" — see D-4 in .agents status. Role-agnostic
     * general job boards are the most valuable links and must not be hidden
     * from role pages by requiring an explicit entry.
     */
    roles: z.array(slugSchema).default([]),

    description: z.string().min(10).max(200),

    /**
     * Set false while a description is machine-drafted and unreviewed.
     * Blocked from export until a human or a reviewing agent sets it true, so
     * invented facts can never reach the public site.
     */
    // Defaults to FALSE, not true. A description is unverified until a human
    // says otherwise.
    //
    // This was `default(true)`, which meant every link file that omitted the
    // field was reported as verified -- and all 67 migrated descriptions are
    // machine-written from the old README, never reviewed. The stats command
    // duly reported "67/67 verified". The default has to fail safe, because
    // the pool promotion gate depends on this flag being honest.
    description_verified: z.boolean().default(false),

    /** GitHub usernames of everyone who contributed this entry. */
    contributors: z.array(githubUserSchema).default([]),

    added_at: notInFuture('added_at'),
    // Nullable, because a link promoted out of the pool has genuinely never
    // been checked -- `check-links` owns that fact. Making it required forced
    // either a fabricated date or a schema failure at promotion time.
    last_checked: notInFuture('last_checked').nullable().default(null),

    /** Curated highlights, shown at the top of a country page. */
    featured: z.boolean().default(false),

    /** Free-form extras, e.g. `free`, `eu-only`, `newsletter`, `german`. */
    tags: z.array(z.string().min(1).max(24)).max(8).default([]),
  })
  .strict()
  .refine((link) => link.scopes === undefined || link.scopes.includes(link.country), {
    message: 'scopes must include the primary country',
    path: ['scopes'],
  })
  // `last_checked` may be null (never checked), in which case there is
  // nothing to compare against. `null >= '2026-01-01'` is false, so without
  // this guard an unchecked link would always fail the refinement.
  .refine((link) => link.last_checked === null || link.last_checked >= link.added_at, {
    message: 'last_checked must not be before added_at',
    path: ['last_checked'],
  });

export type Link = z.infer<typeof linkSchema>;

// ---------------------------------------------------------------------------
// Post — editorial content
// ---------------------------------------------------------------------------

export const postSchema = z
  .object({
    title: z.string().min(5).max(140),
    description: z.string().min(20).max(300),
    published: notInFuture('published'),
    updated: z.iso.date().optional(),
    author: slugSchema,
    tags: z.array(slugSchema).default([]),
    draft: z.boolean().default(false),
    /** ISO date only, injected at build time. Never hand-write this. */
    lastmod: z.string().optional(),
  })
  .strict()
  .refine((post) => !post.updated || post.updated >= post.published, {
    message: 'updated must not be before published',
    path: ['updated'],
  });

export type Post = z.infer<typeof postSchema>;

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

export const collectionSchemas = {
  countries: countrySchema,
  categories: categorySchema,
  groups: groupSchema,
  roles: roleSchema,
  authors: authorSchema,
  links: linkSchema,
  posts: postSchema,
} as const;
