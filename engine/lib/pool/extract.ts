/**
 * HTML/Markdown -> candidate links. Pure: no IO, no network, no clock.
 *
 * Split out so the harvester is testable without a network, and so the junk
 * filter is a set of named rules rather than one opaque regex.
 */

/** Hosts that are never a resource, only infrastructure around one. */
const JUNK_HOSTS = new Set([
  'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'linkedin.com',
  'youtube.com', 'youtu.be', 'reddit.com', 't.me', 'telegram.me',
  'discord.com', 'discord.gg', 'slack.com', 'patreon.com', 'paypal.com',
  'twitter.github.io', 'github.io', 'gitter.im', 'mastodon.social',
  'medium.com', 'substack.com', 'wordpress.com', 'blogspot.com',
  'bit.ly', 't.co',
]);

/** Path prefixes that mark a page as an index or an account, not a resource. */
const JUNK_PATH_PREFIXES = [
  '/sponsors', '/sponsor', '/donate', '/contribute', '/contributing',
  '/about', '/license', '/licence', '/code-of-conduct',
  '/press', '/newsletter', '/twitter', '/stargazers', '/network',
  '/graphs/contributors', '/pulse', '/security',
  '/issues', '/pulls', '/search', '/login', '/signin', '/register',
  '/account', '/settings', '/notifications', '/explore', '/trending',
  '/collections', '/topics', '/tags', '/users/', '/u/',
];

/** Filenames that are never a human-facing page. */
const JUNK_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|ico|css|js|mjs|json|xml|txt|rss|atom|zip|tar|gz|pdf|epub|mp4|mp3|woff2?|ttf|eot)$/i;

const UTM = /^(utm_.+|ref|ref_src|referrer|source|fbclid|gclid|igshid|_hsenc|_hsmi|igsh|mc_cid|mc_eid|mc_[a-z]+)$/i;

/** Strips tracking params and sorts the rest, so two forms of one URL collide. */
export function stripTracking(url: string): { clean: string; removed: string[] } {
  const parsed = new URL(url);
  const removed: string[] = [];
  for (const key of [...parsed.searchParams.keys()]) {
    if (UTM.test(key)) {
      removed.push(key);
      parsed.searchParams.delete(key);
    }
  }
  parsed.searchParams.sort();
  return { clean: parsed.toString(), removed };
}

export function isJunkUrl(url: string): { junk: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { junk: true, reason: 'unparseable' };
  }
  if (parsed.protocol !== 'https:') {
    return { junk: true, reason: parsed.protocol === 'http:' ? 'not-https' : 'bad-protocol' };
  }
  if (JUNK_HOSTS.has(parsed.hostname.replace(/^www\./, ''))) return { junk: true, reason: 'social-host' };

  const path = parsed.pathname.toLowerCase();
  for (const prefix of JUNK_PATH_PREFIXES) {
    if (path.startsWith(prefix)) return { junk: true, reason: 'junk-path:' + prefix };
  }
  if (parsed.pathname === '/' || parsed.pathname === '') return { junk: true, reason: 'homepage' };
  if (JUNK_EXTENSIONS.test(parsed.pathname)) return { junk: true, reason: 'non-html-file' };
  if (path.includes('/pull/') || path.includes('/blob/main/license')) return { junk: true, reason: 'repo-internal' };

  // A very long slug is almost always an auto-generated permalink.
  const slug = path.split('/').filter(Boolean).pop() ?? '';
  if (slug.length > 120) return { junk: true, reason: 'slug-too-long' };
  return { junk: false };
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'",
  ldquo: '"', rdquo: '"', middot: '*', bull: '-',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Strips a partial tag left at either edge of a slice.
 *
 * Slicing raw HTML at an arbitrary offset lands mid-tag, and `htmlToText`
 * then turns leftover attribute text into prose, so `class="btn" hidden>`
 * ends up in the middle of a sentence. This text is fed to a model, so it has
 * to be clean.
 */
function trimToTagBoundaries(fragment: string): string {
  let out = fragment;
  if (out && !out.startsWith('<')) {
    const close = out.indexOf('>');
    out = close === -1 ? '' : out.slice(close + 1);
  }
  const lastOpen = out.lastIndexOf('<');
  if (lastOpen !== -1 && out.indexOf('>', lastOpen) === -1) out = out.slice(0, lastOpen);
  return out;
}

export interface ExtractedLink {
  url: string;
  title: string;
  context: string;
}

/**
 * Pulls anchors with their surrounding text.
 *
 * The context is what lets the classifier and describer work from evidence
 * rather than a bare title; a link labelled just "Resources" cannot be
 * described honestly, and the describer is meant to refuse in that case.
 */
export function extractLinks(html: string, baseUrl: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = anchor.exec(html)) !== null) {
    const [full, attrs, inner] = match as unknown as [string, string, string];
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href) continue;

    let absolute: string;
    try {
      absolute = new URL(decodeEntities(href), baseUrl).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(absolute)) continue;

    const title = htmlToText(inner).replace(/\s+/g, ' ').trim();
    if (!title || title.length < 3) continue;

    const before = htmlToText(trimToTagBoundaries(html.slice(Math.max(0, match.index - 600), match.index)));
    const after = htmlToText(
      trimToTagBoundaries(html.slice(match.index + full.length, match.index + full.length + 400)),
    );
    const context = (before.slice(-160) + ' [' + title + '] ' + after.slice(0, 160))
      .replace(/\s+/g, ' ')
      .trim();

    out.push({ url: absolute, title, context });
  }
  return out;
}

/** GitHub READMEs are markdown; a separate, simpler extractor. */
export function extractMarkdownLinks(body: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const re = /\[([^\]]{3,200})\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const before = body.slice(Math.max(0, m.index - 300), m.index).replace(/\s+/g, ' ');
    out.push({
      url: m[2]!,
      title: m[1]!.trim(),
      context: (before.slice(-160) + ' [' + m[1]!.trim() + ']').trim(),
    });
  }
  return out;
}

/**
 * Path segments that mark a site's own index namespace.
 *
 * `/browse/working`, `/topics/housing`, `/section/taxes` are section indexes
 * on large government and documentation sites, not resources. A curated
 * resource almost never lives at one of these.
 */
const INDEX_NAMESPACES = new Set([
  'browse', 'explore', 'topics', 'topic', 'section', 'sections', 'category',
  'categories', 'directory', 'collections', 'collection', 'index', 'home',
  'main', 'all', 'overview', 'site-map', 'sitemap', 'contents', 'toc',
  'getting-started', 'start-here',
]);

/** Titles that are never a specific resource. */
const GENERIC_TITLES = new Set([
  'help', 'contact', 'contact us', 'about', 'about us', 'home', 'index',
  'overview', 'news', 'get involved', 'sign in', 'log in', 'register',
  'more', 'read more', 'learn more', 'see more', 'view all', 'all',
  'menu', 'navigation', 'skip to content', 'search',
]);

/** "housing-local-services" -> "housing local services" */
function humaniseSlug(segment: string): string {
  return decodeURIComponent(segment)
    .replace(/[-_+]+/g, ' ')
    .replace(/\.\w+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Is this URL a section index rather than a resource?
 *
 * Built from two observed failures:
 *
 *   1. Harvesting `gov.uk/browse/abroad` produced links to
 *      `gov.uk/browse/housing-local-services`, `gov.uk/browse/working`,
 *      `gov.uk/browse/passports` — the site's own navigation, one hop down.
 *      They carry 250-350 words of prose, so a word-count gate passes them.
 *      The first path segment, `browse`, is the tell.
 *   2. Titles that mirror the slug exactly ("Housing and local services" from
 *      `/browse/housing-local-services`) are generated by a CMS, not written
 *      by a person curating a list.
 *
 * Both are high-precision: a real resource title rarely reproduces its slug
 * word for word, and rarely sits under a site-wide index namespace.
 *
 * `isJunkUrl` catches hosts and extensions; this catches the *shape* of a page.
 */
export function looksLikeIndex(url: string, title: string): { index: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { index: false };
  }

  const segments = parsed.pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
  const first = segments[0];
  if (first && INDEX_NAMESPACES.has(first)) {
    return { index: true, reason: 'index-namespace:/' + first };
  }

  const cleanTitle = title.trim().toLowerCase().replace(/[.!?,;:]+$/, '');
  if (GENERIC_TITLES.has(cleanTitle)) return { index: true, reason: 'generic-title' };

  // Title mirrors the slug: CMS-generated, not curated.
  const slug = segments.at(-1);
  if (slug) {
    const humanised = humaniseSlug(slug);
    const stop = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'and', 'in', 'on', 'your', 'how', 'what', 'why']);
    const slugWords = humanised.split(' ').filter((w) => w && !stop.has(w));
    const titleWords = cleanTitle.split(' ').filter((w) => w && !stop.has(w));
    if (slugWords.length >= 2 && titleWords.length >= 2) {
      const shared = slugWords.filter((w) => titleWords.includes(w)).length;
      // Every content word in the title also appears in the slug.
      if (shared === titleWords.length) return { index: true, reason: 'title-mirrors-slug' };
    }
  }

  return { index: false };
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Strips a trailing " - Site Name" suffix, which is noise for dedup. */
export function cleanTitle(title: string): string {
  return title.replace(/\s*[|–—-]\s*[^|–—-]{2,30}$/, '').replace(/\s+/g, ' ').trim();
}

const CHROME = [
  /<script\b[^>]*>[\s\S]*?<\/script>/gi,
  /<style\b[^>]*>[\s\S]*?<\/style>/gi,
  /<nav\b[^>]*>[\s\S]*?<\/nav>/gi,
  /<header\b[^>]*>[\s\S]*?<\/header>/gi,
  /<footer\b[^>]*>[\s\S]*?<\/footer>/gi,
  /<aside\b[^>]*>[\s\S]*?<\/aside>/gi,
  /<[^>]+class="[^"]*(cookie|consent|banner|skip-link|share|social|related|newsletter|subscribe|breadcrumb|promo)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi,
  /<div\b[^>]+id="[^"]*(cookie|consent|banner)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
];

/**
 * Page text fit for a model prompt.
 *
 * `htmlToText` over a whole page is mostly cookie banners and nav menus. They
 * say nothing about the link and, within a fixed budget, push the actual
 * content out. Chrome is dropped first, then near-duplicate lines from nav
 * lists are collapsed.
 */
export function mainContentText(html: string, limit = 2000): string {
  let cleaned = html;
  for (const pattern of CHROME) cleaned = cleaned.replace(pattern, ' ');

  const lines = htmlToText(cleaned)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  const seen = new Set<string>();
  const kept: string[] = [];
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    kept.push(line);
  }
  return kept.join('\n').slice(0, limit);
}
