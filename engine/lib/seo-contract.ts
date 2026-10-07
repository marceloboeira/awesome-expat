import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent, type Content } from './content.ts';

/**
 * The SEO contract, enforced inside `astro build` (see siteArtifacts in
 * artifacts.ts) -- not as a lint someone can forget.
 *
 * Two jobs:
 *
 * 1. Quality floors per page kind (title/description length, visible word
 *    count, required JSON-LD types), so a newly indexed country or category
 *    cannot ship below the bar the hand-fixed pages now meet.
 * 2. Cross-artifact sync: sitemap vs dist, sitemap lastmod vs the corpus
 *    computed through the ENGINE's own membership predicates (not the copies
 *    in astro.config or src/lib/corpus.ts -- if any of the three drift, this
 *    check is where it surfaces), and llms.txt / llms-full.txt / corpus.json
 *    against `content/`.
 */

export interface Violation {
  route: string;
  message: string;
}

interface Contract {
  kind: string;
  title: [number, number];
  description: [number, number];
  words: number;
  ld: string[];
}

const contracts: (Contract & { match: RegExp })[] = [
  {
    kind: 'home',
    match: /^\/$/,
    title: [45, 65],
    description: [110, 165],
    words: 120,
    ld: ['Organization', 'WebSite'],
  },
  {
    // /countries/de/... /categories/housing/... /roles/x/... /roles/x/de/...
    // /countries/de/housing/ ... /global/
    kind: 'collection',
    match: /^\/(global\/|countries\/[a-z]{2}(\/[a-z-]+)?\/|categories\/[a-z-]+\/|roles\/[a-z-]+(\/[a-z]{2})?\/)$/,
    title: [42, 68],
    description: [100, 165],
    words: 90,
    ld: ['Organization', 'CollectionPage', 'ItemList', 'BreadcrumbList'],
  },
  {
    kind: 'page',
    match: /^\/(countries\/|categories\/|roles\/|contributors\/|about\/|stats\/|jobs\/|contribute\/)$/,
    title: [45, 65],
    description: [110, 165],
    words: 150,
    ld: ['Organization'],
  },
  {
    // Contributor profiles are generated from GitHub handles; the name is the
    // unit of content and we do not get to lengthen it. Floor is honest here.
    kind: 'contributor',
    match: /^\/contributors\/[^/]+\/$/,
    title: [25, 75],
    description: [90, 200],
    words: 40,
    ld: ['Organization', 'ProfilePage'],
  },
];

const contractFor = (route: string): Contract | null =>
  contracts.find((c) => c.match.test(route)) ?? null;

// --- HTML extraction -------------------------------------------------------

/** Length as a search engine counts it: the decoded string, not the markup. */
const decode = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&apos;/g, "'");

const titleOf = (html: string): string => decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '');
const descriptionOf = (html: string): string =>
  decode(/name="description" content="([^"]*)"/.exec(html)?.[1] ?? '');

const wordCount = (html: string): number => {
  const body = html.replace(/<(script|style|head)[\s\S]*?<\/\1>/g, ' ');
  const text = body
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/g, ' ')
    .replace(/\s+/g, ' ');
  return text.split(' ').filter(Boolean).length;
};

const ldTypes = (html: string): Set<string> => {
  const types = new Set<string>();
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const graph = JSON.parse(m[1] as string);
      const nodes = Array.isArray(graph['@graph']) ? graph['@graph'] : [graph];
      for (const n of nodes) {
        if (n['@type']) types.add(String(n['@type']));
      }
    } catch {
      /* counted as missing by the required-types check below */
    }
  }
  return types;
};

const isPage = (f: string): boolean => f === 'index.html' || f.endsWith('/index.html');

const routeOf = (rel: string): string => {
  const raw = '/' + rel.replace(/index\.html$/, '');
  return raw === '/' ? '/' : raw;
};

// --- lastmod expectations, computed through the engine loader --------------

const maxAdded = (rs: { added_at: string }[]): string =>
  rs.map((r) => r.added_at).sort().at(-1) ?? '';

function expectedLastmods(content: Content): Map<string, string | null> {
  const links = content.links.map((l) => l.data);
  const forCountry = (code: string) =>
    links.filter((l) => l.country === code || (l.scopes ?? []).includes(code));
  const corpusMax = maxAdded(links);

  const m = new Map<string, string | null>();
  m.set('/', corpusMax);
  for (const p of ['/countries/', '/categories/', '/roles/', '/contributors/', '/jobs/', '/stats/']) {
    m.set(p, corpusMax);
  }
  m.set('/about/', null);
  m.set('/contribute/', null);
  m.set('/global/', maxAdded(links.filter((l) => l.country === 'global')));

  for (const code of content.countries.keys()) {
    const inC = forCountry(code);
    if (inC.length === 0) continue;
    m.set(`/countries/${code}/`, maxAdded(inC));
    for (const cat of content.categories.keys()) {
      const d = maxAdded(inC.filter((l) => l.category === cat));
      if (d) m.set(`/countries/${code}/${cat}/`, d);
    }
  }
  for (const slug of content.categories.keys()) {
    m.set(`/categories/${slug}/`, maxAdded(links.filter((l) => l.category === slug)));
  }
  for (const slug of content.roles.keys()) {
    const applicable = (l: (typeof links)[number]) =>
      l.roles.includes(slug) || (l.roles ?? []).length === 0;
    m.set(`/roles/${slug}/`, maxAdded(links.filter(applicable)));
    for (const code of content.countries.keys()) {
      if (!inHas(content, code)) continue;
      const d = maxAdded(forCountry(code).filter(applicable));
      if (d) m.set(`/roles/${slug}/${code}/`, d);
    }
  }
  const handles = new Set(links.flatMap((l) => l.contributors ?? []));
  for (const h of [...handles].sort()) {
    m.set(`/contributors/${h}/`, maxAdded(links.filter((l) => (l.contributors ?? []).includes(h))));
  }
  return m;
}

const inHas = (content: Content, code: string): boolean =>
  content.links.some((l) => l.data.country === code || (l.data.scopes ?? []).includes(code));

// --- the check -------------------------------------------------------------

export async function checkSeoContract(distDir: string): Promise<Violation[]> {
  const content = await loadContent();
  const violations: Violation[] = [];
  const fail = (route: string, message: string) => violations.push({ route, message });

  const walk = (dir: string, base = ''): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`],
    );

  // 1. sitemap vs dist
  const sitemapXml = readFileSync(join(distDir, 'sitemap-0.xml'), 'utf8');
  const sitemapUrls = [...sitemapXml.matchAll(/<url><loc>https:\/\/awesome-expat\.com([^<]*)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)];
  const sitemapRoutes = new Map<string, string | null>();
  for (const [, route, lastmod] of sitemapUrls) sitemapRoutes.set(route || '/', lastmod ?? null);

  const pages = walk(distDir).filter(isPage);
  const indexable: string[] = [];
  for (const rel of pages) {
    const html = readFileSync(join(distDir, rel), 'utf8');
    const route = routeOf(rel);
    const noindex = html.includes('noindex, follow');
    if (!noindex) indexable.push(route);
    if (noindex) continue;

    const contract = contractFor(route);
    if (!contract) {
      // Indexable page with no contract entry: the route set grew without the
      // contract growing with it. That is exactly the out-of-sync case.
      fail(route, 'indexable page has no SEO contract entry (add it to `contracts`)');
      continue;
    }
    if (sitemapRoutes.has(route) === false) fail(route, 'indexable page missing from sitemap');

    const title = titleOf(html);
    if (title.length < contract.title[0] || title.length > contract.title[1]) {
      fail(route, `title ${title.length}ch outside ${contract.title.join('-')}: "${title}"`);
    }
    const desc = descriptionOf(html);
    if (desc.length < contract.description[0] || desc.length > contract.description[1]) {
      fail(route, `description ${desc.length}ch outside ${contract.description.join('-')}`);
    }
    const words = wordCount(html);
    if (words < contract.words) {
      fail(route, `${words} words, floor is ${contract.words}`);
    }
    const types = ldTypes(html);
    for (const t of contract.ld) {
      if (!types.has(t)) fail(route, `missing JSON-LD ${t}`);
    }
  }

  // 2. sitemap entries all exist as pages
  const routeSet = new Set(pages.map(routeOf));
  for (const route of sitemapRoutes.keys()) {
    if (!routeSet.has(route)) fail(route, 'sitemap URL has no page in dist');
  }

  // 3. lastmod: what the sitemap says vs what the engine corpus says
  const expected = expectedLastmods(content);
  for (const [route, lastmod] of sitemapRoutes) {
    if (route === '/404/' || route === '/search/') continue;
    const want = expected.get(route);
    if (want === undefined) {
      if (lastmod) fail(route, `sitemap has lastmod ${lastmod} for a route the corpus does not describe`);
      continue;
    }
    const wantIso = want ? `${want}T00:00:00.000Z` : null;
    if (lastmod !== wantIso) {
      fail(route, `sitemap lastmod ${lastmod ?? 'none'} != corpus ${wantIso ?? 'none'}`);
    }
  }

  // 4. generated artifacts vs content
  const corpus = JSON.parse(readFileSync(join(distDir, 'corpus.json'), 'utf8'));
  if (corpus.links.length !== content.links.length) {
    fail('/corpus.json', `has ${corpus.links.length} links, content has ${content.links.length}`);
  }
  const corpusUrls = new Set(corpus.links.map((l: { url: string }) => l.url));
  for (const l of content.links) {
    if (!corpusUrls.has(l.data.url)) fail('/corpus.json', `missing ${l.data.url}`);
  }

  const llms = readFileSync(join(distDir, 'llms.txt'), 'utf8');
  if (!llms.includes(`${content.links.length} resources`)) {
    fail('/llms.txt', `does not state the real total (${content.links.length})`);
  }
  const llmsFull = readFileSync(join(distDir, 'llms-full.txt'), 'utf8');
  for (const l of content.links) {
    if (!llmsFull.includes(l.data.title)) fail('/llms-full.txt', `missing "${l.data.title}"`);
  }

  return violations;
}
