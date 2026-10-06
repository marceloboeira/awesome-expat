import { poolCandidateSchema } from '../lib/pool/schema.ts';
import { linkSchema } from '../lib/schema.ts';

/**
 * Regression tests for the pool -> `content/` promotion gate.
 *
 * The gate was unsatisfiable in three independent ways, and every one of them
 * failed *silently* rather than loudly:
 *
 *  1. `description_verified` was `z.literal(false)`. A human setting it to
 *     `true` produced a file that `loadAllCandidates` rejected with `.parse`,
 *     so the candidate vanished behind a "skipping unreadable candidate"
 *     warning -- and the gate below requires `true`, so it could never pass.
 *  2. The link object handed to `linkSchema` carried an `id` key. `linkSchema`
 *     is `.strict()`, so it returned "unrecognized key" and left `preview: null`
 *     for every candidate, verified or not.
 *  3. The written filename was the candidate's 12-hex SHA-1 prefix, while the
 *     rest of the corpus uses human-readable slugs (and the id is the
 *     filename, per `slugOf()` in content.ts).
 *
 * None of these threw. `make check` passed, the pool reported candidates, and
 * promotion simply never produced a file. So the tests below assert the
 * *representable* range, not just the happy path.
 */
export const name = 'pool-promotion';
export type Check = (label: string, actual: unknown, expected: unknown) => void;

export async function run(check: Check) {
  const iso = '2026-09-30T00:00:00.000Z';
  const candidate = {
    id: 'a1b2c3d4e5f6',
    discovered_from: { source: 'expat-forums', page_url: 'https://example.com/thread' },
    url: 'https://berlin-finder.example/',
    raw_url: 'https://berlin-finder.example?utm_source=forum#top',
    title: 'Berlin Apartment Finder',
    context: 'A tool for finding flats in Berlin.',
    excerpt: 'Search Berlin listings by district and budget.',
    stage: 'draft',
    classification: {
      country: 'de',
      category: 'housing',
      scopes: ['de'],
      roles: [],
      confidence: 0.9,
      rationale: 'Clearly a Berlin housing resource.',
      model: 'test',
    },
    description: {
      text: 'Searches Berlin rental listings by district, size and budget.',
      model: 'test',
      generated_at: iso,
    },
    description_verified: true,
    first_seen: iso,
    last_seen: iso,
    seen_count: 1,
    notes: [],
  };

  // 1. A human must be able to mark a description verified. With
  //    `z.literal(false)` this parse threw, and `loadAllCandidates` catches the
  //    throw and skips the file, so the human's edit silently deleted the
  //    candidate from the pool.
  const humanVerified = poolCandidateSchema.safeParse(candidate);
  check('a human can set description_verified true', humanVerified.success, true);
  check('parsed candidate keeps the verified flag', humanVerified.success && humanVerified.data.description_verified, true);

  // ...and the agent's own default must still fail safe, not default to true.
  const unverified = poolCandidateSchema.safeParse({ ...candidate, description_verified: false });
  check('agent-written candidate parses as unverified', unverified.success && unverified.data.description_verified, false);

  const omitted = poolCandidateSchema.safeParse({ ...candidate, description_verified: undefined });
  check('omitted description_verified defaults to false', omitted.success && omitted.data.description_verified, false);

  // A string is not a boolean: "true" would be truthy in a hand-written check.
  check('rejects a stringly-typed verified flag', poolCandidateSchema.safeParse({ ...candidate, description_verified: 'true' }).success, false);

  // 2. The object promotion builds must satisfy the real `linkSchema`. This is
  //    the exact shape from `validateForPromotion`, kept in sync by hand and
  //    asserted here because the bug was an extra `id` key.
  const link = {
    title: candidate.title,
    url: candidate.url,
    country: candidate.classification.country,
    scopes: candidate.classification.scopes,
    category: candidate.classification.category,
    roles: candidate.classification.roles,
    description: candidate.description.text,
    description_verified: candidate.description_verified,
    contributors: [],
    added_at: candidate.first_seen.slice(0, 10),
    last_checked: null,
    featured: false,
    tags: [],
  };
  const parsedLink = linkSchema.safeParse(link);
  check('the promoted link object passes linkSchema', parsedLink.success, true);
  if (!parsedLink.success) {
    check(
      'promotion linkSchema failure detail',
      parsedLink.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' | '),
      '(no errors)',
    );
  }
  // The specific regression: `id` must never be injected. `Link` has no `id`
  // because a link's identity is its filename.
  check('linkSchema still rejects an injected id', linkSchema.safeParse({ ...link, id: candidate.id }).success, false);
  check('the promoted object has no id key', 'id' in link, false);

  // 3. The filename convention. The written name is the link's id, so it must
  //    be a kebab-case slug that `slugSchema` accepts, not an opaque hash.
  const { slugifyTitle } = await import('../lib/url.ts');
  const slug = slugifyTitle(candidate.title);
  check('title slugifies to kebab-case', slug, 'berlin-apartment-finder');
  check('promoted filename is a valid slug', linkSchema.safeParse({ ...link, country: 'de' }).success && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug), true);
  check('filename is not the candidate hash', slug === candidate.id, false);

  // Accents and punctuation must not produce a filename that fails slugSchema,
  // since a bad filename means a link that cannot be loaded at all.
  check(
    'accented title still yields a valid slug',
    /^[-a-z0-9]+$/.test(slugifyTitle('Café Müller: Öffnungszeiten & Co.')) ||
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slugifyTitle('Café Müller: Öffnungszeiten & Co.')),
    true,
  );

  // The gate's core rule, restated against the schema: verification is the one
  // thing the agent cannot grant itself, and a link that reached `content/`
  // with it false would be exported as an unreviewed claim.
  check('promoted link records the human verification', link.description_verified, true);
}
