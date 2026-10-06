// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

const SITE = 'https://awesome-expat.com';

/**
 * Country pages with no links in them.
 *
 * Those pages are published (a reader asking "anything for Bhutan?" deserves a
 * real answer, not a 404) but they carry `noindex`, and a `noindex` URL in the
 * sitemap is a contradiction -- it is an explicit "index me" to any crawler
 * that reads the sitemap. The same list drives the page's robots meta, so
 * there is one source of truth for what is thin.
 *
 * Read straight off disk rather than through the content layer, because the
 * sitemap has to be filterable at config-evaluation time, before any page has
 * rendered.
 */
const emptyCountryCodes = new Set(
  readdirSync(new URL('./content/countries', import.meta.url))
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.replace(/\.ya?ml$/, ''))
    .filter((code) => {
      let has = false;
      const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const p = `${dir}/${entry.name}`;
          if (entry.isDirectory()) walk(p);
          else if (entry.name.endsWith('.yaml')) {
            const data = parseYaml(readFileSync(p, 'utf8'));
            const country = data?.country;
            const scopes = data?.scopes ?? [];
            if (country === code || scopes.includes(code)) has = true;
          }
        }
      };
      walk(new URL('./content/links', import.meta.url).pathname);
      return !has;
    }),
);

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
  trailingSlash: 'never',
  build: {
    format: 'directory',
    assets: '_assets',
  },
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname;
        // Anything the site marks `noindex` is also kept out of the sitemap.
        // `/search` is the case that is easy to miss: a search results page
        // that ranks is a near-duplicate of every page it can return.
        if (path === '/search' || path === '/404') return false;
        const m = /^\/countries\/([a-z]{2})$/.exec(path);
        if (m && emptyCountryCodes.has(m[1])) return false;
        return !page.includes('/categories/citizenship') && !page.includes('/categories/permanent-residency');
      },
    }),
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
