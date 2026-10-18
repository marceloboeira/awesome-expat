/**
 * URL construction, shared by the CLI and the site.
 *
 * Lives in the engine rather than in `src/` so `export-markdown` and Astro
 * build byte-identical links. A Markdown doc pointing at `/de/housing/` while
 * the site serves `/de/housing` is a broken link that no test would catch
 * unless both sides import from one place.
 *
 * Every shape here must match `src/lib/routes.ts`, which is what the build
 * actually emits. They used to drift, and the drift shipped: the Markdown said
 * `/au/` and `/jobs/software-engineer/` while the site served
 * `/countries/au/` and `/roles/software-engineer/`.
 *
 * `engine/test/routes.test.ts` pins each builder against the matching function
 * in `src/lib/routes.ts`. Run `make test` after touching either file, or the
 * next builder added to one side only will drift exactly the way these did.
 *
 * The builders below are deliberately few. There is no `/groups/`, `/blog/`
 * or `/authors/` route in `src/pages/`, so there is no builder for them: a URL
 * helper for a page that does not exist is a way to ship a broken link.
 */

export const SITE = 'https://awesome-expat.com';

/**
 * `global` is a content bucket, not a place.
 *
 * It is a real country registry entry (every link needs a `country:`), but
 * `/countries/global/` has never been a page -- the global view lives at
 * `/global/`. `src/pages/countries/[code].astro` filters `global` out of the
 * country list for the same reason. Without this branch the exporter writes a
 * 404 into the README, which is what it used to do.
 */
const isGlobal = (slug: string) => slug === 'global';

/** Country code as a path segment. */
export function countryPath(slug: string): string {
  return isGlobal(slug) ? '/global/' : `/countries/${slug}/`;
}

/** Category index page, `/categories/`. */
export function categoriesPath(): string {
  return '/categories/';
}

/** Category page. */
export function categoryPath(slug: string): string {
  return `/categories/${slug}/`;
}

/** Category scoped to a country. */
export function categoryInCountryPath(country: string, category: string): string {
  return `/countries/${country}/${category}/`;
}

/** Country index page, `/countries/`. */
export function countriesPath(): string {
  return '/countries/';
}

/**
 * Role index, `/roles/`.
 *
 * Distinct from `/jobs/`, which is the job-boards page. Sending a reader who
 * asked "resources for my job" to the boards page instead of the role index is
 * the kind of quietly wrong link that reads as plausible.
 */
export function rolesPath(): string {
  return '/roles/';
}

/** Job boards page, `/jobs/`. */
export function jobsPath(): string {
  return '/jobs/';
}

/** Role page, optionally narrowed to one country. */
export function rolePath(slug: string, country?: string): string {
  return country ? `/roles/${slug}/${country}/` : `/roles/${slug}/`;
}

/** Strip a leading and trailing slash, for slug derivation. */
export function trimSlashes(path: string): string {
  return path.replace(/^\/+|\/+$/g, '');
}
