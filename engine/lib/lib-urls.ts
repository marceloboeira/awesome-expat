/**
 * URL construction, shared by the CLI and the site.
 *
 * Lives in the engine rather than in `src/` so `export-markdown` and Astro
 * build byte-identical links. A Markdown doc pointing at `/de/housing/` while
 * the site serves `/de/housing` is a broken link that no test would catch
 * unless both sides import from one place.
 */

export const SITE = 'https://awesome-expat.com';

/** Country code as a path segment. */
export function countryPath(slug: string): string {
  return `/${slug}/`;
}

/** Category scoped to a country. */
export function categoryPath(country: string, category: string): string {
  return `/${country}/${category}/`;
}

/** Role index. */
export function rolesPath(): string {
  return '/jobs/';
}

/** Role page, optionally narrowed to one country. */
export function rolePath(slug: string, country?: string): string {
  return country ? `/jobs/${slug}/${country}/` : `/jobs/${slug}/`;
}

/** Group page. */
export function groupPath(slug: string): string {
  return `/groups/${slug}/`;
}

/** Editorial post. */
export function postPath(...segments: string[]): string {
  return `/blog/${segments.join('/')}/`;
}

/** Author profile. */
export function authorPath(handle: string): string {
  return `/authors/${handle}/`;
}

/** Strip a leading and trailing slash, for slug derivation. */
export function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}
