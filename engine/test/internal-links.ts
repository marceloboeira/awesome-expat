/**
 * Internal link checker for the built site.
 *
 * Run against `dist/` after `astro build`. It resolves every internal `href`
 * against what was actually emitted, so a link to a page that no longer
 * generates -- or never did -- fails here rather than in a search index.
 *
 * Two bugs this caught during the first build, both invisible by eye:
 * a `categoriesWithLinks` helper returning `undefined` (so `/categories/undefined`
 * appeared on two pages), and the `global` pseudo-country being linked as
 * `/countries/global`, a page that has never existed because `global` is a
 * content bucket rather than a place.
 *
 * Not a crawler: it follows `href` only, checks the local filesystem, and
 * never leaves the machine. `make links-check` is what validates external URLs.
 */
import { readFileSync, readdirSync, type Dirent } from 'node:fs';

const DIST = 'dist';

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) =>
    entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  );

const all = walk(DIST);
const isPage = (f: string): boolean => f === `${DIST}/index.html` || f.endsWith('/index.html');

const routeOf = (f: string): string => {
  const raw = '/' + f.slice(DIST.length + 1).replace(/index\.html$/, '');
  return raw === '/' ? '/' : raw.replace(/\/$/, '');
};

const pages = all.filter(isPage).map(routeOf);
const assets = new Set(
  all.filter((f) => !f.endsWith('.html')).map((f) => '/' + f.slice(DIST.length + 1)),
);

const resolves = (href: string): boolean => {
  const path = href.split('#')[0]?.split('?')[0] ?? '';
  if (path === '' || path === '/') return true;
  const trimmed = path.length > 1 ? path.replace(/\/$/, '') : path;
  return pages.includes(trimmed) || assets.has(path) || assets.has(trimmed);
};

let checked = 0;
const dead = new Map<string, Set<string>>();

for (const file of walk(DIST).filter(isPage)) {
  const html = readFileSync(file, 'utf8');
  for (const match of html.matchAll(/href="(\/[^"]*)"/g)) {
    const href = match[1]!;
    checked++;
    if (resolves(href)) continue;
    if (!dead.has(href)) dead.set(href, new Set());
    dead.get(href)?.add(routeOf(file));
  }
}

console.log(`checked ${checked} internal links across ${pages.length} pages`);

if (dead.size === 0) {
  console.log('internal links: OK');
} else {
  console.error(`internal links: ${dead.size} dead`);
  for (const [href, sources] of dead) {
    const from = [...sources];
    const shown = from.slice(0, 3).join(', ');
    console.error(`  ${href}  (from ${shown}${from.length > 3 ? `, +${from.length - 3} more` : ''})`);
  }
  process.exitCode = 1;
}
