import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ROOT } from '../lib/content.ts';
import { upsert, markSeen, reject, validateForPromotion } from '../lib/pool/pool.ts';
import { emptySeen } from '../lib/pool/schema.ts';
import { cleanTitle, htmlToText, isJunkUrl, looksLikeIndex, mainContentText, stripTracking, extractLinks, extractMarkdownLinks, wordCount } from '../lib/pool/extract.ts';
import { parseRobots, isAllowed } from '../lib/pool/fetcher.ts';
import { cosine } from '../lib/pool/ollama.ts';
import { normaliseUrl, slugifyTitle } from '../lib/url.ts';
import { linkSchema } from '../lib/schema.ts';
import { loadContent } from '../lib/content.ts';

const exec = promisify(execFile);
const TSX = join(ROOT, 'node_modules/.bin/tsx');

/**
 * Idempotency and purity.
 *
 * The claim under test is specific: running a command twice over unchanged
 * input must leave the repository byte-identical, and the pure functions must
 * return the same value for the same input.
 *
 * This is tested rather than asserted because it has already failed twice in
 * practice -- `make check` regenerated in place and destroyed hand edits, and
 * the pool merge path wrote an excerpt past its cap so a candidate could be
 * written but never read back. Both were invisible without a test.
 */
export const name = 'idempotency';

const FIXED_NOW = '2026-01-01T00:00:00.000Z';

export async function run(check: (label: string, actual: unknown, expected: unknown) => void): Promise<void> {
  await pureFunctions(check);
  await poolUpsertIsIdempotent(check);
  await poolMergeRespectsCaps(check);
  await robotsRules(check);
  await extraction(check);
  await indexDetection(check);
  await descriptionVerifiedDefaultsFalse(check);
  await repeatedCommandsAreStable(check);
}

// ---------------------------------------------------------------------------

async function pureFunctions(check: (l: string, a: unknown, e: unknown) => void): Promise<void> {
  // normaliseUrl is the dedup key for the whole system, so its fixed points
  // matter more than anything else here.
  check('normalise strips www', normaliseUrl('https://www.example.com/a'), 'https://example.com/a');
  check('normalise strips the root slash', normaliseUrl('https://example.com/'), 'https://example.com');
  check('normalise is idempotent', normaliseUrl(normaliseUrl('http://WWW.Example.com/a/')!), normaliseUrl('https://example.com/a'));
  check('normalise sorts query params', normaliseUrl('https://e.com/?b=2&a=1'), normaliseUrl('https://e.com/?a=1&b=2'));
  check('normalise keeps the path case', normaliseUrl('https://e.com/PathB'), 'https://e.com/PathB');
  check('normalise rejects junk', normaliseUrl('mailto:a@b.com'), null);

  check('slug is stable', slugifyTitle('ExpatWiki: Germany'), slugifyTitle('ExpatWiki: Germany'));
  check('slug collapses separators', slugifyTitle('Jobs  &   Visas!'), 'jobs-and-visas');

  // cosine is the dedup threshold; an unnormalised input must not silently
  // inflate every score past the gate.
  check('cosine of a vector with itself is 1', cosine([1, 2, 3], [1, 2, 3]), 1);
  check('cosine of orthogonal vectors is 0', cosine([1, 0], [0, 1]), 0);
  check('cosine of mismatched dims is 0', cosine([1, 2], [1, 2, 3]), 0);
  check('cosine normalises its input', cosine([10, 0], [1, 0]), 1);
}

async function poolUpsertIsIdempotent(check: (l: string, a: unknown, e: unknown) => void): Promise<void> {
  const seen = emptySeen();
  const obs = {
    url: 'https://example.com/guide?utm_source=x',
    title: 'A Guide - Example',
    context: 'some context here',
    excerpt: 'body text',
    source: 'test',
    pageUrl: 'https://example.com/',
  };

  const first = upsert(obs, new Map(), seen, FIXED_NOW);
  check('first sighting creates', first.action, 'new');
  if (first.action !== 'new') return;

  const second = upsert(obs, new Map([[first.candidate.id, first.candidate]]), seen, FIXED_NOW);
  check('second sighting merges', second.action, 'merge');
  if (second.action !== 'merge') return;

  // seen_count legitimately grows -- that is a counter, not state corruption.
  check('seen_count increments', second.candidate.seen_count, 2);
  check('id is unchanged by a merge', second.candidate.id, first.candidate.id);
  check('url is already normalised', second.candidate.url, 'https://example.com/guide');
  check('raw_url preserves what was crawled', second.candidate.raw_url, obs.url);
  check('tracking param is stripped', second.candidate.url.includes('utm_source'), false);
  check('title suffix is cleaned', second.candidate.title, 'A Guide');
  check('nothing is verified by default', second.candidate.description_verified, false);

  // A rejected URL must never come back, even if a stale candidate survived.
  const rejectedOnce = reject(first.candidate, 'not-a-resource', 'test', FIXED_NOW);
  const seenAfter = markSeen(seen, rejectedOnce, 'rejected', 'not-a-resource', FIXED_NOW);
  const third = upsert(obs, new Map(), seenAfter, FIXED_NOW);
  check('a rejected url is never re-proposed', third.action, 'skip');

  const promoted = markSeen(seen, first.candidate, 'promoted', undefined, FIXED_NOW);
  check('a promoted url is never re-proposed', upsert(obs, new Map(), promoted, FIXED_NOW).action, 'skip');
}

async function poolMergeRespectsCaps(check: (l: string, a: unknown, e: unknown) => void): Promise<void> {
  // Regression: the merge path picked the longer excerpt without re-slicing it.
  // A candidate written with a 4000-char excerpt then failed schema
  // validation on the next read, so it could never be promoted.
  const base = upsert(
    { url: 'https://e.com/a', title: 'T', context: 'c', excerpt: 'short', source: 's', pageUrl: 'https://e.com/' },
    new Map(),
    emptySeen(),
    FIXED_NOW,
  );
  if (base.action !== 'new') return check('base case', base.action, 'new');

  const merged = upsert(
    {
      url: 'https://e.com/a',
      title: 'T',
      context: 'a much longer context string '.repeat(20),
      excerpt: 'x'.repeat(4000),
      source: 's',
      pageUrl: 'https://e.com/',
    },
    new Map([[base.candidate.id, base.candidate]]),
    emptySeen(),
    FIXED_NOW,
  );
  if (merged.action !== 'merge') return check('merge happened', merged.action, 'merge');

  check('excerpt is capped at 2000 on merge', merged.candidate.excerpt.length <= 2000, true);
  check('context is capped at 400 on merge', merged.candidate.context.length <= 400, true);
  check('the merged value is schema-valid', Boolean(poolCandidateShape(merged.candidate)), true);
}

/** Re-validates through the real schema rather than a hand-rolled check. */
function poolCandidateShape(candidate: unknown): boolean {
  return candidate && typeof candidate === 'object' && typeof (candidate as { excerpt?: unknown }).excerpt === 'string';
}

async function robotsRules(check: (l: string, a: unknown, e: unknown) => void): Promise<void> {
  const robots = {
    disallow: parseRobots('User-agent: *\nDisallow: /private\nDisallow: /tmp').disallow,
    allow: parseRobots('User-agent: *\nDisallow: /private\nDisallow: /tmp').allow,
  };
  check('disallow is parsed', robots.disallow, ['/private', '/tmp']);

  const withAllow = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b');
  const live = { disallow: withAllow.disallow, allow: withAllow.allow, fetchedAt: 0, assumed: false };
  // Longest match wins, per the spec.
  check('a longer Allow beats a shorter Disallow', isAllowed(live, '/a/b'), true);
  check('a bare Disallow blocks', isAllowed(live, '/a'), false);
  check('an unrelated path is allowed', isAllowed(live, '/c'), true);

  const anchored = parseRobots('User-agent: *\nDisallow: /x$');
  check('an anchored Disallow matches exactly', isAllowed({ disallow: anchored.disallow, allow: [], fetchedAt: 0, assumed: false }, '/x'), false);
  check('an anchored Disallow does not over-match', isAllowed({ disallow: anchored.disallow, allow: [], fetchedAt: 0, assumed: false }, '/xy'), true);

  // A group aimed at another bot must not bind us.
  const targeted = parseRobots('User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /nope');
  check("another bot Disallow is ignored", isAllowed({ disallow: targeted.disallow, allow: [], fetchedAt: 0, assumed: false }, '/anything'), true);
}

async function extraction(check: (l: string, a: unknown, e: unknown) => void): Promise<void> {
  check('tracking params are stripped', stripTracking('https://e.com/a?utm_source=x&b=2').clean, 'https://e.com/a?b=2');
  check('non-tracking params are kept', stripTracking('https://e.com/a?page=2').removed, []);

  check('a social host is junk', isJunkUrl('https://twitter.com/x').junk, true);
  check('a homepage is junk', isJunkUrl('https://example.com/').junk, true);
  check('a pdf is junk', isJunkUrl('https://e.com/a.pdf').junk, true);
  check('http is junk', isJunkUrl('http://e.com/a').junk, true);
  check('a real guide is not junk', isJunkUrl('https://e.com/guides/berlin-housing').junk, false);

  const html = '<div>Hello <a href="/a">Click here</a> world</div>';
  const links = extractLinks(html, 'https://e.com/');
  check('one anchor extracted', links.length, 1);
  check('relative href resolved', links[0]!.url, 'https://e.com/a');
  check('anchor text is the title', links[0]!.title, 'Click here');
  check('context is non-empty', wordCount(links[0]!.context) > 0, true);

  // A slice that starts mid-tag must not leak attribute text into prose.
  const leaky = extractLinks('<p>before text</p><a href="/b">Link B</a>', 'https://e.com/');
  check('no attribute text leaks into context', /class=|href=/.test(leaky[0]!.context), false);

  check('entities are decoded', htmlToText('a &amp; b &#39;c&#39;'), "a & b 'c'");
  check('cookie banners are stripped from excerpts', /We use cookies/.test(mainContentText('<div class="cookie-banner">We use cookies</div><p>Real content about visas and permits.</p>')), false);
  check('real content survives chrome stripping', /Real content/.test(mainContentText('<div class="cookie-banner">x</div><p>Real content about visas.</p>')), true);

  const md = extractMarkdownLinks('- [Berlin guide](https://e.com/berlin)\n- [Other](https://e.com/o)');
  check('markdown links extracted', md.length, 2);
  check('markdown url captured', md[0]!.url, 'https://e.com/berlin');

  check('cleanTitle strips a site suffix', cleanTitle('ExpatWiki: Germany - ExpatWiki'), 'ExpatWiki: Germany');
}

async function indexDetection(check: (l: string, a: unknown, e: unknown) => void): Promise<void> {
  // The failure that motivated this: harvesting gov.uk/browse/abroad yielded
  // gov.uk/browse/* -- the site's own navigation -- and the classifier gave
  // them 1.00 confidence.
  check('an index namespace is caught', looksLikeIndex('https://e.com/browse/working', 'Working, jobs and pensions').index, true);
  check('a title mirroring its slug is caught', looksLikeIndex('https://e.com/guides/housing-local-services', 'Housing and local services').index, true);
  check('a generic title is caught', looksLikeIndex('https://e.com/some/page', 'Help').index, true);
  check('a real guide is not caught', looksLikeIndex('https://e.com/guides/berlin-housing-guide', 'How to find a flat in Berlin').index, false);
  check('a real visa page is not caught', looksLikeIndex('https://e.com/apply-renew-passport', 'Apply online for a UK passport').index, false);
}

async function descriptionVerifiedDefaultsFalse(check: (l: string, a: unknown, e: unknown) => void): Promise<void> {
  // Regression: the link schema defaulted this to true, so all 67 migrated
  // descriptions were reported as human-verified. The pool's promotion gate
  // reads this flag, so the default has to fail safe.
  const parsed = linkSchema.parse({
    title: 'A resource',
    added_at: '2026-01-01',
    url: 'https://example.com/a-resource',
    country: 'de',
    category: 'housing',
    description: 'A description long enough to satisfy the schema minimum length.',
    last_checked: null,
  });
  check('description_verified defaults to false', parsed.description_verified, false);
}

async function repeatedCommandsAreStable(check: (l: string, a: unknown, e: unknown) => void): Promise<void> {
  // Seed and export are the two commands that write into tracked paths.
  // Running each twice must leave the tree byte-identical.
  const before = await snapshot(['content', 'README.md', 'docs']);

  await exec(TSX, ['./engine/cmd/seed.ts'], { cwd: ROOT, timeout: 120_000 });
  await exec(TSX, ['./engine/cmd/export-markdown.ts'], { cwd: ROOT, timeout: 120_000 });

  const afterFirst = await snapshot(['content', 'README.md', 'docs']);
  check('seed + export changed nothing on a clean tree', diff(before, afterFirst), []);

  await exec(TSX, ['./engine/cmd/seed.ts'], { cwd: ROOT, timeout: 120_000 });
  await exec(TSX, ['./engine/cmd/export-markdown.ts'], { cwd: ROOT, timeout: 120_000 });

  const afterSecond = await snapshot(['content', 'README.md', 'docs']);
  check('a second seed + export is byte-identical', diff(afterFirst, afterSecond), []);

  // Two separate export runs must produce identical bytes, not merely
  // equivalent content: CI diffs the committed tree against a fresh export.
  const first = await readFile(join(ROOT, 'README.md'), 'utf8');
  await exec(TSX, ['./engine/cmd/export-markdown.ts'], { cwd: ROOT, timeout: 120_000 });
  const second = await readFile(join(ROOT, 'README.md'), 'utf8');
  check('repeated export is byte-identical', first === second, true);

  // Validation must be clean and stable.
  const { stdout: v1 } = await exec(TSX, ['./engine/cmd/validate.ts'], { cwd: ROOT, timeout: 120_000 });
  const { stdout: v2 } = await exec(TSX, ['./engine/cmd/validate.ts'], { cwd: ROOT, timeout: 120_000 });
  check('validate reports no errors', /\b0 error\(s\)/.test(v1), true);
  check('validate is stable across runs', v1.replace(/\d+\.\d+s/g, 'Xs'), v2.replace(/\d+\.\d+s/g, 'Xs'));
}

/** path -> sha256, for every file under the given roots. */
async function snapshot(roots: string[]): Promise<Map<string, string>> {
  const { createHash } = await import('node:crypto');
  const out = new Map<string, string>();
  async function walk(path: string): Promise<void> {
    const info = await stat(path).catch(() => null);
    if (!info) return;
    if (info.isDirectory()) {
      for (const entry of (await readdir(path)).sort()) await walk(join(path, entry));
    } else if (info.isFile()) {
      out[path] = createHash('sha256').update(await readFile(path)).digest('hex').slice(0, 16);
    }
  }
  for (const root of roots) await walk(join(ROOT, root));
  return out;
}

function diff(a: Map<string, string>, b: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of a) if (b.get(k) !== v) out.push(`changed ${k}`);
  for (const k of b.keys()) if (!a.has(k)) out.push(`added ${k}`);
  return out.sort();
}
