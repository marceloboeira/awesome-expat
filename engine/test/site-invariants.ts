/**
 * Post-build site invariants.
 *
 * Each check here is a claim the site makes about itself that a successful
 * build would not otherwise catch:
 *
 *  1. Sitemap/robots agreement. A `noindex` URL inside a sitemap is an
 *     explicit contradiction -- it tells a crawler "index me" and "do not
 *     index me" in the same breath. Conversely, an indexable page missing
 *     from the sitemap is invisible to search for no good reason.
 *  2. Canonical URLs must match the page they are on. `build.format:
 *     'directory'` emits `dist/about/index.html` for `/about`, so the built
 *     path and the canonical path differ by a slash; both go through the same
 *     normaliser so the comparison is meaningful.
 *  3. One non-empty `<h1>` per page. Two means the document outline is
 *     ambiguous; zero means the page has no stated subject.
 *  4. Title and description present and long enough to be useful. Country and
 *     category pages are generated, so a missing description is easy to
 *     introduce and invisible by eye.
 *  5. Every `<img>` has `alt`. There are none today; this keeps it true.
 *
 * Run after `astro build`, against `dist/`.
 */
import { readFileSync, readdirSync, type Dirent } from 'node:fs';

const DIST = 'dist';

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  );

/** A rendered route: `dist/about/index.html` is the page at `/about/`. */
const isPage = (f: string): boolean => f === `${DIST}/index.html` || f.endsWith('/index.html');

// The site's canonical form carries the trailing slash (trailingSlash 'always'
// + directory format, matching what the host serves at 200), so route,
// canonical and sitemap entry all agree on `/about/`.
const routeOf = (f: string): string => {
  const raw = '/' + f.slice(DIST.length + 1).replace(/index\.html$/, '');
  return raw === '/' ? '/' : raw;
};

const pages = walk(DIST).filter(isPage);
const failures: string[] = [];
const fail = (message: string): void => { failures.push(message); };
const check = (ok: boolean, message: string): void => { if (!ok) fail(message); };

const sitemapXml = readFileSync(`${DIST}/sitemap-0.xml`, 'utf8');
const inSitemap = new Set(
  [...sitemapXml.matchAll(/<loc>https:\/\/awesome-expat\.com([^<]*)<\/loc>/g)].map((m) => m[1] || '/'),
);

let noindexCount = 0;

for (const file of pages) {
  const html = readFileSync(file, 'utf8');
  const route = routeOf(file);
  const noindex = html.includes('noindex, follow');
  if (noindex) noindexCount++;

  // 1 + 2: sitemap and canonical must agree with the page itself.
  check(!noindex || !inSitemap.has(route), `noindex page listed in sitemap: ${route}`);
  check(noindex || inSitemap.has(route), `indexable page missing from sitemap: ${route}`);

  const canonical = html.match(/<link rel="canonical" href="https:\/\/awesome-expat\.com([^"]*)"/)?.[1];
  if (canonical === undefined) {
    fail(`no canonical link: ${route}`);
  } else {
    check((canonical || '/') === route, `canonical mismatch: ${route} -> ${canonical || '/'}`);
  }

  // 3: exactly one non-empty h1.
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m: RegExpMatchArray) =>
    (m[1] ?? '').replace(/<[^>]*>/g, '').trim(),
  );
  check(h1s.length === 1, `expected 1 h1, found ${h1s.length}: ${route}`);
  check(h1s.every((t) => t.length > 0), `empty h1: ${route}`);

  // 4: title and description.
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
  check(title.length > 5, `title too short (${title.length}): ${route}`);
  check(description.length > 20, `description too short (${description.length}): ${route}`);

  // 5: images carry alt text.
  for (const img of html.matchAll(/<img\b[^>]*>/g)) {
    check(/\balt=/.test(img[0]), `img without alt: ${route}`);
  }
}

console.log(
  `pages: ${pages.length}  indexable: ${pages.length - noindexCount}  noindex: ${noindexCount}  sitemap: ${inSitemap.size}`,
);

if (failures.length === 0) {
  console.log('site invariants: OK');
} else {
  console.error(`site invariants: ${failures.length} failure(s)`);
  for (const message of failures.slice(0, 40)) console.error(`  ${message}`);
  if (failures.length > 40) console.error(`  ...and ${failures.length - 40} more`);
  process.exitCode = 1;
}
