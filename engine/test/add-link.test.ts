import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildLinkRecord,
  cleanTitle,
  extractTitle,
  idForTitle,
  uniqueId,
  MAX_ID,
} from '../lib/add-link.ts';
import { linkSchema } from '../lib/schema.ts';

/**
 * Tests for the pure half of `make add-link`.
 *
 * These cover the two decisions that fail *quietly*: picking a title off the
 * wrong element, and choosing a filename that already exists. Neither throws
 * when wrong — the first writes a plausible but wrong title, the second
 * overwrites a real entry while `make validate` still reports a clean tree.
 *
 * The assertions are mostly about what the helpers must NOT do, because every
 * failure mode here is a fabricated or destroyed value rather than a crash.
 */
export const name = 'add-link';
export type Check = (label: string, actual: unknown, expected: unknown) => void;

export async function run(check: Check) {
  // --- cleanTitle: the site-name tail ------------------------------------
  check(
    'drops a trailing site name',
    cleanTitle('Find a flat in Berlin | Example', 'https://example.com/berlin'),
    'Find a flat in Berlin',
  );
  check(
    'drops a trailing site name with an em dash',
    cleanTitle('Anmeldung guide — example', 'https://www.example.com/x'),
    'Anmeldung guide',
  );
  check(
    'keeps a title that merely contains the site name',
    cleanTitle('Example of a Berlin tenancy', 'https://example.com/x'),
    'Example of a Berlin tenancy',
  );
  // Stripping the tail here would leave "Ex", so the original is kept whole.
  // Losing the title entirely would be worse than a slightly untidy one.
  check(
    'keeps the whole title when stripping would leave too little',
    cleanTitle('Ex | example', 'https://example.com/x'),
    'Ex | example',
  );
  check('returns null for a blank title', cleanTitle('   ', 'https://example.com/x'), null);

  // Truncation must land on the schema ceiling with a visible ellipsis, so a
  // 400-character scraped title cannot fail linkSchema on `max(120)`.
  const long = `${'a'.repeat(200)}`;
  const truncated = cleanTitle(long, 'https://example.com/x');
  check('truncates an over-long title', truncated?.length, 120);
  check('marks a truncation with an ellipsis', truncated?.endsWith('...'), true);

  // --- extractTitle: precedence -----------------------------------------
  const html = `<html><head>
      <title>Site Name — Page</title>
      <meta property="og:title" content="The Real Resource Name">
    </head><body><h1>An H1</h1></body></html>`;
  check('prefers og:title over <title> and <h1>', extractTitle(html, 'https://example.com/'), 'The Real Resource Name');

  const h1Only = `<html><head><title>Site Name — Page</title></head><body><h1>Heading Wins</h1></body></html>`;
  check('falls back to h1', extractTitle(h1Only, 'https://example.com/'), 'Heading Wins');

  const titleOnly = `<html><head><title>Bare Title</title></head><body></body></html>`;
  check('falls back to <title>', extractTitle(titleOnly, 'https://example.com/'), 'Bare Title');

  check('returns null when there is no title at all', extractTitle('<html><body>hi</body></html>', 'https://example.com/'), null);

  // Strip tags: an h1 is usually markup, not text.
  const markedUp = `<h1><span>Berlin</span> <em>Flats</em></h1>`;
  check('strips tags out of the h1', extractTitle(`<html>${markedUp}</html>`, 'https://example.com/'), 'Berlin Flats');

  const entities = `<h1>Caf&eacute;s &amp;amp; more</h1>`;
  check('decodes the common entities', extractTitle(`<html>${entities}</html>`, 'https://example.com/'), 'Caf&eacute;s &amp; more');

  // --- idForTitle --------------------------------------------------------
  check('slugifies a title', idForTitle('Berlin Apartment Finder'), 'berlin-apartment-finder');
  check('strips an extension from an override', idForTitle('Anything', 'custom-name.yaml'), 'custom-name');
  check(
    'never exceeds the schema id ceiling',
    idForTitle(`${'word '.repeat(40)}end`).length <= MAX_ID,
    true,
  );
  // A trailing dash would make an id fail slugSchema's kebab-case rule.
  check('never leaves a trailing dash', idForTitle('Berlin flats-'), 'berlin-flats');

  // --- buildLinkRecord: nothing silently dropped -------------------------
  //
  // `roles` was once validated and then left out of the written object, so the
  // file parsed cleanly and the flag simply vanished. These assert that every
  // requested field survives into the record.
  const full = buildLinkRecord({
    title: 'A Reasonable Title',
    url: 'https://example.com',
    country: 'de',
    category: 'housing',
    description: 'A description that is definitely long enough to pass.',
    addedAt: '2026-01-01',
    scopes: ['at', 'ch'],
    roles: ['software-engineer'],
    tags: ['free', 'eu-only'],
    contributors: ['riko68'],
    featured: true,
  });
  check('keeps roles', full.roles, ['software-engineer']);
  check('keeps tags', full.tags, ['free', 'eu-only']);
  check('keeps contributors', full.contributors, ['riko68']);
  check('keeps featured', full.featured, true);
  check('puts the primary country first in scopes', full.scopes, ['de', 'at', 'ch']);
  check('defaults last_checked to null', full.last_checked, null);
  check('defaults description_verified to false', full.description_verified, false);

  // `--scopes=de` on a link already filed under de adds nothing, so the key is
  // left out rather than written as a redundant one-element list.
  check(
    'omits scopes when they name only the primary country',
    'scopes' in
      buildLinkRecord({
        title: 'T',
        url: 'https://example.com',
        country: 'de',
        category: 'housing',
        description: 'Long enough to satisfy the schema.',
        addedAt: '2026-01-01',
        scopes: ['de', 'de'],
      }),
    false,
  );
  check(
    'drops the primary country from the middle of a scope list',
    buildLinkRecord({
      title: 'T',
      url: 'https://example.com',
      country: 'de',
      category: 'housing',
      description: 'Long enough to satisfy the schema.',
      addedAt: '2026-01-01',
      scopes: ['at', 'de', 'ch'],
    }).scopes,
    ['de', 'at', 'ch'],
  );
  check(
    'omits scopes entirely for a single-country link',
    'scopes' in
      buildLinkRecord({
        title: 'T',
        url: 'https://example.com',
        country: 'de',
        category: 'housing',
        description: 'Long enough to satisfy the schema.',
        addedAt: '2026-01-01',
      }),
    false,
  );

  // Whatever the record contains, the real schema must accept it.
  check('a full generated record satisfies linkSchema', linkSchema.safeParse(full).success, true);
  check(
    'a minimal generated record satisfies linkSchema',
    linkSchema.safeParse(
      buildLinkRecord({
        title: 'A Reasonable Title',
        url: 'https://example.com',
        country: 'de',
        category: 'housing',
        description: 'A description that is definitely long enough to pass.',
        addedAt: '2026-01-01',
      }),
    ).success,
    true,
  );

  // --- uniqueId: never clobber ------------------------------------------
  const dir = await mkdtemp(join(tmpdir(), 'add-link-test-'));
  await mkdir(dir, { recursive: true });

  check('uses the id when nothing is taken', await uniqueId(dir, 'berlin-flats'), 'berlin-flats');

  await writeFile(join(dir, 'berlin-flats.yaml'), 'existing', 'utf8');
  // Regression: this used to write over the existing file.
  check('appends -2 on collision', await uniqueId(dir, 'berlin-flats'), 'berlin-flats-2');

  await writeFile(join(dir, 'berlin-flats-2.yaml'), 'existing', 'utf8');
  check('appends -3 when -2 is taken too', await uniqueId(dir, 'berlin-flats'), 'berlin-flats-3');

  // A gap in the numbering is filled rather than skipped: with gap.yaml and
  // gap-2.yaml both present, a new "gap" entry takes gap-3, not gap-4.
  await writeFile(join(dir, 'gap.yaml'), 'existing', 'utf8');
  await writeFile(join(dir, 'gap-2.yaml'), 'existing', 'utf8');
  check('fills a gap in the numbering', await uniqueId(dir, 'gap'), 'gap-3');
  // ...and an id that is itself free is used as-is, with no suffix.
  check('does not suffix an id that is free', await uniqueId(dir, 'gap-9'), 'gap-9');
}
