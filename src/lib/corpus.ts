import type { Country, Category, Role, Link } from '@engine/schema.ts';

/**
 * Deriving the site's view of the corpus.
 *
 * The rules encoded here are the ones the engine already enforces on the YAML
 * (scope membership, role thresholds, the global pseudo-country). Keeping the
 * same logic in one module means a page can never disagree with `make check`
 * about which links belong where.
 *
 * `LoadedLink` is the loaded entry: `id` plus `data`. Keeping the shape
 * explicit is what lets the pool and the site agree on a link's identity.
 */

export interface LoadedLink {
  id: string;
  data: Link;
}

export interface RolePage {
  role: Role;
  /** role-specific links only */
  specific: LoadedLink[];
  /** role-agnostic links, i.e. `roles: []` */
  general: LoadedLink[];
  /** specific + general, which is what the page renders */
  all: LoadedLink[];
  /** the total that decides whether the page is published at all */
  applicable: number;
}

export const ROLE_PAGE_THRESHOLD = 3;

export const isGlobal = (country: Country): boolean => country.global === true;

/**
 * Links visible on a country's page.
 *
 * Both a primary filing and a `scopes` entry count, because both put the link
 * in front of a reader looking for help in that country. The distinction
 * matters in the other direction: only primary links are *about* that country,
 * and only those are counted as its coverage.
 */
export function linksForCountry(links: LoadedLink[], code: string): LoadedLink[] {
  return links.filter((l) => l.data.country === code || (l.data.scopes ?? []).includes(code));
}

export function primaryLinksForCountry(links: LoadedLink[], code: string): LoadedLink[] {
  return links.filter((l) => l.data.country === code);
}

export function linksForCategory(links: LoadedLink[], categorySlug: string): LoadedLink[] {
  return links.filter((l) => l.data.category === categorySlug);
}

export function linksForCountryCategory(
  links: LoadedLink[],
  countryCode: string,
  categorySlug: string,
): LoadedLink[] {
  return linksForCountry(links, countryCode).filter((l) => l.data.category === categorySlug);
}

export function buildRolePage(role: Role, links: LoadedLink[]): RolePage {
  const specific = links.filter((l) => l.data.roles.includes(role.slug));
  const general = links.filter((l) => (l.data.roles ?? []).length === 0);
  return {
    role,
    specific,
    general,
    all: [...specific, ...general],
    applicable: specific.length + general.length,
  };
}

export const roleHasEnoughLinks = (page: RolePage): boolean => page.applicable >= ROLE_PAGE_THRESHOLD;

/** Newest first, with the id as a stable tiebreak so output never flickers. */
export function byNewest(a: LoadedLink, b: LoadedLink): number {
  const cmp = (b.data.added_at ?? '').localeCompare(a.data.added_at ?? '');
  return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
}

export function byTitle(a: LoadedLink, b: LoadedLink): number {
  return a.data.title.localeCompare(b.data.title);
}

export function featuredFirst(a: LoadedLink, b: LoadedLink): number {
  const diff = Number(b.data.featured) - Number(a.data.featured);
  return diff !== 0 ? diff : byNewest(a, b);
}

export const countrySlugOf = (c: Country): string => c.slug ?? c.code;

/** Countries that have at least one primary link, most-covered first. */
export function countriesWithLinks(links: LoadedLink[], countries: Country[]): Country[] {
  return countries
    .map((country) => ({ country, count: primaryLinksForCountry(links, countrySlugOf(country)).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.country.name.localeCompare(b.country.name))
    .map((r) => r.country);
}

export function categoriesWithLinks(links: LoadedLink[], categories: Category[]): Category[] {
  return categories
    .map((c) => ({ c, count: linksForCategory(links, c.slug).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.c.slug.localeCompare(b.c.slug))
    .map((r) => r.c);
}

/** Categories a country actually has links for, for its sidebar. */
export function categoriesForCountry(
  links: LoadedLink[],
  countryCode: string,
  categories: Category[],
): { category: Category; count: number }[] {
  const visible = linksForCountry(links, countryCode);
  return categories
    .map((c) => ({ category: c, count: visible.filter((l) => l.data.category === c.slug).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.category.slug.localeCompare(b.category.slug));
}

// ---------------------------------------------------------------------------
// Contributors
// ---------------------------------------------------------------------------

/**
 * A contributor is a GitHub username that appears in at least one link's
 * `contributors` array. The identity is the normalised username (lowercased,
 * `@` stripped by `githubUserSchema`), not an author registry slug -- so a
 * person with no `content/authors` entry still gets a page from the corpus
 * alone. The registry, where it matches, only adds a display name and bio.
 */
export interface Contributor {
  handle: string;
  /** The links this person contributed, most recent first. */
  links: LoadedLink[];
}

/**
 * Every contributor, most contributions first, ties broken by handle so the
 * order never flickers between builds.
 *
 * Built from the union of all `link.data.contributors`. A link that lists no
 * contributors contributes nothing here -- there is no invented attribution.
 */
export function buildContributors(links: LoadedLink[]): Contributor[] {
  const byHandle = new Map<string, LoadedLink[]>();
  for (const link of links) {
    for (const handle of link.data.contributors ?? []) {
      const bucket = byHandle.get(handle);
      if (bucket) bucket.push(link);
      else byHandle.set(handle, [link]);
    }
  }
  return [...byHandle.entries()]
    .map(([handle, owned]) => ({ handle, links: [...owned].sort(byNewest) }))
    .sort((a, b) => b.links.length - a.links.length || a.handle.localeCompare(b.handle));
}

/** The links a single contributor added, newest first. */
export function linksForContributor(links: LoadedLink[], handle: string): LoadedLink[] {
  return links.filter((l) => (l.data.contributors ?? []).includes(handle)).sort(byNewest);
}

/** Distinct countries a contributor's links touch, global last. */
export function countriesForContributor(contrib: Contributor, countryNames: Record<string, string>): string[] {
  return [...new Set(contrib.links.map((l) => l.data.country))].sort((a, b) => {
    if (a === 'global') return 1;
    if (b === 'global') return -1;
    return (countryNames[a] ?? a).localeCompare(countryNames[b] ?? b);
  });
}
