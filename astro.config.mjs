// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { siteArtifacts } from './engine/lib/artifacts.ts';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const SITE = 'https://awesome-expat.com';

/**
 * The corpus, read straight off disk rather than through the content layer,
 * because the sitemap has to be filterable at config-evaluation time, before
 * any page has rendered.
 *
 * `linkRecords` is one parsed YAML per link file, keeping exactly the fields
 * the sitemap and the noindex logic below need.
 */
const readYamlTree = (dir) => {
  /** @type {any[]} */
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${entry.name}`;
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.yaml')) out.push(parseYaml(readFileSync(p, 'utf8')));
    }
  };
  walk(dir);
  return out.filter(Boolean);
};

const linksDir = new URL('./content/links', import.meta.url).pathname;
const linkRecords = readYamlTree(linksDir).map((l) => ({
  country: l.country,
  category: l.category,
  scopes: l.scopes ?? [],
  roles: l.roles ?? [],
  contributors: l.contributors ?? [],
  added_at: l.added_at,
}));

// Predicates mirroring src/lib/corpus.ts; keep the two in sync. A lastmod
// that disagrees with a page's actual contents is worse than no lastmod.
const forCountry = (code) => linkRecords.filter((l) => l.country === code || l.scopes.includes(code));
const forCategory = (slug) => linkRecords.filter((l) => l.category === slug);
const newest = (rs) => rs.reduce((max, r) => (r.added_at > max ? r.added_at : max), '');

const slugsFrom = (dir) =>
  readdirSync(new URL(dir, import.meta.url))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.ya?ml$/, ''));

const countryCodes = slugsFrom('./content/countries');
const categorySlugs = slugsFrom('./content/categories');
const roleSlugs = slugsFrom('./content/roles');
const contributorHandles = [...new Set(linkRecords.flatMap((l) => l.contributors))];

// <lastmod> is the date the page last changed in a way a reader would notice:
// the newest `added_at` among the links it actually contains. Curation pages
// (country/category/role/contributor views) and the corpus-wide indexes move
// whenever the corpus they read moves, so they get the corpus-wide max.
// /about and /contribute are static prose and get no lastmod at all.
const corpusMax = newest(linkRecords);
const lastmodByPath = new Map();
lastmodByPath.set('/', corpusMax);
for (const p of ['/countries/', '/categories/', '/roles/', '/contributors/', '/jobs/', '/stats/']) {
  lastmodByPath.set(p, corpusMax);
}
lastmodByPath.set('/global/', newest(linkRecords.filter((l) => l.country === 'global')));
for (const code of countryCodes) {
  const inCountry = forCountry(code);
  const d = newest(inCountry);
  if (d) lastmodByPath.set(`/countries/${code}/`, d);
  for (const cat of categorySlugs) {
    const pair = newest(inCountry.filter((l) => l.category === cat));
    if (pair) lastmodByPath.set(`/countries/${code}/${cat}/`, pair);
  }
}
for (const slug of categorySlugs) {
  const d = newest(forCategory(slug));
  if (d) lastmodByPath.set(`/categories/${slug}/`, d);
}
for (const slug of roleSlugs) {
  // buildRolePage shows links tagged with this role *plus* links with no role
  // at all, so those two sets -- and nothing else -- move these pages.
  const applicable = (l) => l.roles.includes(slug) || l.roles.length === 0;
  const d = newest(linkRecords.filter(applicable));
  if (d) lastmodByPath.set(`/roles/${slug}/`, d);
  for (const code of countryCodes) {
    const pair = newest(forCountry(code).filter(applicable));
    if (pair) lastmodByPath.set(`/roles/${slug}/${code}/`, pair);
  }
}
for (const handle of contributorHandles) {
  const d = newest(linkRecords.filter((l) => l.contributors.includes(handle)));
  if (d) lastmodByPath.set(`/contributors/${handle}/`, d);
}

/**
 * Country pages with no links in them.
 *
 * Those pages are published (a reader asking "anything for Bhutan?" deserves a
 * real answer, not a 404) but they carry `noindex`, and a `noindex` URL in the
 * sitemap is a contradiction -- it is an explicit "index me" to any crawler
 * that reads the sitemap. The same list drives the page's robots meta, so
 * there is one source of truth for what is thin.
 */
const emptyCountryCodes = new Set(countryCodes.filter((code) => forCountry(code).length === 0));

/**
 * Astro 7, static output, no adapter.
 *
 * The static output is the point, not a limitation: the whole directory is 67
 * YAML files and 0 posts today. There is no per-request work, so a CDN plus a
 * static host is both the fastest and the cheapest thing that can possibly
 * serve it, and it cannot fall over.
 *
 * The site build deliberately does NOT run the pool. `.agents/pool/` is
 * ignored by git and is quarantined from `content/`; only `content/` reaches
 * the build, and only via `linkSchema`.
 */
export default defineConfig({
  site: SITE,
  output: 'static',
  build: {
    // 'directory' + trailingSlash 'always' matches what the host actually
    // serves. GitHub Pages 301-redirects /about to /about/ when pages build
    // to about/index.html; with the old 'never' setting, every canonical and
    // every sitemap URL pointed at the slash-less form, i.e. at a redirect.
    // Now served URL == canonical == sitemap entry, with no redirect in
    // between ('file' format would have put .html into the sitemap instead).
    format: 'directory',
    assets: '_assets',
  },
  trailingSlash: 'always',
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname;
        // Anything the site marks `noindex` is also kept out of the sitemap.
        // `/search` is the case that is easy to miss: a search results page
        // that ranks is a near-duplicate of every page it can return.
        if (path === '/search/' || path === '/404/') return false;
        const m = /^\/countries\/([a-z]{2})\/$/.exec(path);
        if (m && emptyCountryCodes.has(m[1])) return false;
        return !page.includes('/categories/citizenship') && !page.includes('/categories/permanent-residency');
      },
      // Per-URL <lastmod> from the corpus (see lastmodByPath above). Pages
      // with no derivable date -- static prose like /about -- are emitted
      // untouched, which beats a fabricated date.
      serialize: (item) => {
        const d = lastmodByPath.get(new URL(item.url).pathname);
        return d ? { ...item, lastmod: d } : item;
      },
    }),
    // Must come after sitemap: its build:done hook reads dist/sitemap-0.xml.
    siteArtifacts(),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@engine': fileURLToPath(new URL('./engine/lib', import.meta.url)),
        '@site': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
  compressHTML: true,
  devToolbar: { enabled: false },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
});
