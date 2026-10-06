import { linkSchema, countrySchema, slugSchema, githubUserSchema, postSchema } from '../lib/schema.ts';
import { normaliseUrl, slugifyTitle, isNonCanonical } from '../lib/url.ts';

export const name = 'schema';
export type Check = (label: string, actual: unknown, expected: unknown) => void;

export async function run(check: Check) {
  const valid = {
    title: 'Actero', url: 'https://actero.ro', country: 'de',
    scopes: ['de', 'it', 'fr', 'es', 'gb'], category: 'jobs', roles: ['software-engineer'],
    description: 'Remote work platform for European freelancers.',
    contributors: ['@MarceloBoeira'], added_at: '2022-05-01', last_checked: '2026-09-29',
    featured: true, tags: ['eu-only'],
  };

  check('accepts a valid link', linkSchema.safeParse(valid).success, true);
  check('rejects http url', linkSchema.safeParse({ ...valid, url: 'http://actero.ro' }).success, false);
  check('rejects utm param', linkSchema.safeParse({ ...valid, url: 'https://actero.ro/?utm_source=x' }).success, false);
  check('rejects non-kebab role', linkSchema.safeParse({ ...valid, roles: ['Software_Engineer'] }).success, false);
  check('rejects scopes without primary', linkSchema.safeParse({ ...valid, scopes: ['it', 'fr'] }).success, false);
  check('rejects future added_at', linkSchema.safeParse({ ...valid, added_at: '2099-01-01' }).success, false);
  check('rejects future last_checked', linkSchema.safeParse({ ...valid, last_checked: '2099-01-01' }).success, false);
  check('rejects last_checked before added_at', linkSchema.safeParse({ ...valid, added_at: '2026-01-01', last_checked: '2025-01-01' }).success, false);
  check('rejects unknown key', linkSchema.safeParse({ ...valid, bogus: 1 }).success, false);
  check('rejects long title', linkSchema.safeParse({ ...valid, title: 'x'.repeat(200) }).success, false);
  check('rejects short description', linkSchema.safeParse({ ...valid, description: 'short' }).success, false);
  check('rejects uppercase country', linkSchema.safeParse({ ...valid, country: 'DEU' }).success, false);
  check('rejects too many tags', linkSchema.safeParse({ ...valid, tags: Array(20).fill('t') }).success, false);

  const { url: _drop, ...noUrl } = valid;
  check('rejects missing url', linkSchema.safeParse(noUrl).success, false);

  const bare = {
    title: 'Example', url: 'https://example.com', country: 'de', category: 'housing',
    description: 'An example link for the directory.', added_at: '2026-01-01', last_checked: '2026-01-01',
  };
  const parsed = linkSchema.parse(bare);
  check('roles default to []', parsed.roles, []);
  // Was asserted true, which is what let 67 unreviewed descriptions report as
// verified. A description is unverified until a human confirms it.
check('description_verified defaults false', parsed.description_verified, false);
  check('featured defaults false', parsed.featured, false);
  check('contributors default []', parsed.contributors, []);
  check('scopes stays undefined', parsed.scopes, undefined);

  check('country accepts valid', countrySchema.safeParse({ name: 'Germany', code: 'de', region: 'europe' }).success, true);
  check('country rejects uppercase code', countrySchema.safeParse({ name: 'Germany', code: 'DE', region: 'europe' }).success, false);
  check('country rejects bad region', countrySchema.safeParse({ name: 'Germany', code: 'de', region: 'antarctica' }).success, false);
  check('country rejects unknown key', countrySchema.safeParse({ name: 'Germany', code: 'de', region: 'europe', nope: 1 }).success, false);
  check('country requires region', countrySchema.safeParse({ name: 'Germany', code: 'de' }).success, false);
  check('global needs no region', countrySchema.safeParse({ name: 'Global', code: 'zz', global: true }).success, true);
  check('global rejects a region', countrySchema.safeParse({ name: 'Global', code: 'zz', global: true, region: 'europe' }).success, false);

  check('slug accepts kebab', slugSchema.safeParse('job-search').success, true);
  check('slug rejects spaces', slugSchema.safeParse('job search').success, false);
  check('slug rejects uppercase', slugSchema.safeParse('JobSearch').success, false);
  check('slug rejects double dash', slugSchema.safeParse('job--search').success, false);
  check('slug rejects leading dash', slugSchema.safeParse('-job').success, false);

  check('github lowercases and strips @', githubUserSchema.parse('@MarceloBoeira'), 'marceloboeira');
  check('github rejects spaces', githubUserSchema.safeParse('Marcelo Boeira').success, false);
  check('github rejects too long', githubUserSchema.safeParse('a'.repeat(40)).success, false);

  const post = { title: 'Moving to Berlin', description: 'A guide to relocating to Berlin.', published: '2026-01-01', author: 'marcelo' };
  check('post accepts valid', postSchema.safeParse(post).success, true);
  check('post rejects future published', postSchema.safeParse({ ...post, published: '2099-01-01' }).success, false);
  check('post rejects updated before published', postSchema.safeParse({ ...post, updated: '2025-01-01' }).success, false);
  check('post draft defaults false', postSchema.parse(post).draft, false);

  check('normalise strips www', normaliseUrl('https://www.example.com/'), 'https://example.com');
  check('normalise strips trailing slash', normaliseUrl('https://example.com/guide/'), 'https://example.com/guide');
  check('normalise strips utm', normaliseUrl('https://example.com/a?utm_source=x&b=2'), 'https://example.com/a?b=2');
  check('normalise strips fragment', normaliseUrl('https://example.com/a#top'), 'https://example.com/a');
  check('normalise upgrades http', normaliseUrl('http://example.com/a'), 'https://example.com/a');
  check('normalise strips default port', normaliseUrl('https://example.com:443/a'), 'https://example.com/a');
  check('normalise lowercases host', normaliseUrl('https://EXAMPLE.com/A'), 'https://example.com/A');
  check('normalise drops userinfo', normaliseUrl('https://u:p@example.com/a'), 'https://example.com/a');
  check('normalise rejects javascript', normaliseUrl('javascript:alert(1)'), null);
  check('normalise rejects garbage', normaliseUrl('not a url'), null);
  check('isNonCanonical detects http+www', isNonCanonical('http://www.example.com/'), true);
  check('isNonCanonical accepts canonical', isNonCanonical('https://example.com/a'), false);

  check('slugify basic', slugifyTitle('Berlin Apartment Finder'), 'berlin-apartment-finder');
  check('slugify apostrophe', slugifyTitle("Berlin's Guide"), 'berlins-guide');
  check('slugify ampersand', slugifyTitle('Jobs & Visas'), 'jobs-and-visas');
  check('slugify accents', slugifyTitle('São Paulo Housing'), 'sao-paulo-housing');
  check('slugify punctuation', slugifyTitle('Health! Care? Now.'), 'health-care-now');
}
