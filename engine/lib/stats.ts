import { normaliseUrl, isNonCanonical } from './url.ts';
import { ROLE_PAGE_THRESHOLD } from './content.ts';
import type { Content } from './content.ts';

export interface StatsBucket {
  slug: string;
  name: string;
  links: number;
  verified: number;
  /** distinct countries (or categories, for a country) reachable from here */
  coverage: number;
}

export interface RoleBucket {
  slug: string;
  name: string;
  specific: number;
  general: number;
  publishable: boolean;
}

export interface Stats {
  totals: {
    links: number;
    countries_registered: number;
    countries_with_links: number;
    categories: number;
    categories_with_links: number;
    groups: number;
    roles: number;
    authors: number;
    posts: number;
    global_links: number;
    scoped_links: number;
    featured: number;
    tagged: number;
    with_contributors: number;
    verified_descriptions: number;
    unverified_descriptions: number;
    non_canonical_urls: number;
    duplicate_urls: number;
  };
  quality: {
    empty_categories: string[];
    empty_countries: number;
    thin_roles: string[];
    validation_issues: number;
  };
  categories: StatsBucket[];
  countries: StatsBucket[];
  roles: RoleBucket[];
}

/**
 * Directory statistics, derived from the same loaded content the validator
 * uses.
 *
 * This lives in `lib/` rather than in `cmd/stats.ts` because the site renders
 * these numbers on `/stats` too, and two implementations of "what is the
 * coverage" would inevitably drift. The CLI adds formatting; the computation
 * has exactly one home.
 *
 * Two definitions that look like a bug but are not:
 *
 * - A country's `links` counts only primary filings, while `coverage` counts
 *   every link a reader would actually see on that country's page, scoped
 *   entries included. A country whose only link is a shared multi-country
 *   resource has 0 links and non-zero coverage: the page is not empty.
 * - `global` is read from the registry flag rather than hard-coding `zz` or
 *   `global`, because the pseudo-country is keyed by its file slug while links
 *   reference it by name, and neither string is guaranteed.
 */
export function computeStats(content: Content): Stats {
  const links = content.links.map(({ data }) => data);

  // ---- per-category -----------------------------------------------------
  const categories: StatsBucket[] = [];
  for (const [slug, cat] of content.categories) {
    const own = links.filter((l) => l.category === slug);
    const countries = new Set<string>();
    for (const link of own) {
      countries.add(link.country);
      for (const scope of link.scopes ?? []) countries.add(scope);
    }
    categories.push({
      slug,
      name: cat.name,
      links: own.length,
      verified: own.filter((l) => l.description_verified).length,
      coverage: countries.size,
    });
  }
  categories.sort((a, b) => b.links - a.links || a.slug.localeCompare(b.slug));

  // ---- per-country ------------------------------------------------------
  const countries: StatsBucket[] = [];
  for (const [code, country] of content.countries) {
    const own = links.filter((l) => l.country === code);
    const visible = links.filter((l) => l.country === code || (l.scopes ?? []).includes(code));
    countries.push({
      slug: code,
      name: country.name,
      links: own.length,
      verified: own.filter((l) => l.description_verified).length,
      coverage: new Set(visible.map((l) => l.category)).size,
    });
  }
  countries.sort((a, b) => b.links - a.links || a.slug.localeCompare(b.slug));

  // ---- per-role ---------------------------------------------------------
  const roles: RoleBucket[] = [...content.roles.entries()].map(([slug, role]) => {
    const own = links.filter((l) => l.roles.includes(slug));
    const general = links.filter((l) => l.roles.length === 0);
    return {
      slug,
      name: role.name,
      specific: own.length,
      general: general.length,
      publishable: own.length + general.length >= ROLE_PAGE_THRESHOLD,
    };
  });
  roles.sort((a, b) => b.specific - a.specific || a.slug.localeCompare(b.slug));

  // ---- integrity --------------------------------------------------------
  const normalised = new Map<string, number>();
  let nonCanonical = 0;
  let missingVerification = 0;
  for (const link of links) {
    const clean = normaliseUrl(link.url);
    if (clean) normalised.set(clean, (normalised.get(clean) ?? 0) + 1);
    if (isNonCanonical(link.url)) nonCanonical += 1;
    if (!link.description_verified) missingVerification += 1;
  }

  const withContributors = links.filter((l) => (l.contributors ?? []).length > 0).length;
  const globalCodes = new Set(
    [...content.countries.entries()].filter(([, c]) => c.global).map(([slug]) => slug),
  );

  const emptyCategories = categories.filter((c) => c.links === 0);
  const emptyCountries = countries.filter((c) => c.links === 0 && c.coverage === 0);
  const thinRoles = roles.filter((r) => !r.publishable);

  return {
    totals: {
      links: links.length,
      countries_registered: content.countries.size,
      countries_with_links: countries.filter((c) => c.links > 0).length,
      categories: content.categories.size,
      categories_with_links: categories.filter((c) => c.links > 0).length,
      groups: content.groups.size,
      roles: content.roles.size,
      authors: content.authors.size,
      posts: content.posts.length,
      global_links: links.filter((l) => globalCodes.has(l.country)).length,
      scoped_links: links.filter((l) => (l.scopes ?? []).length > 0).length,
      featured: links.filter((l) => l.featured).length,
      tagged: links.filter((l) => (l.tags ?? []).length > 0).length,
      with_contributors: withContributors,
      verified_descriptions: links.length - missingVerification,
      unverified_descriptions: missingVerification,
      non_canonical_urls: nonCanonical,
      duplicate_urls: [...normalised.values()].filter((n) => n > 1).length,
    },
    quality: {
      empty_categories: emptyCategories.map((c) => c.slug),
      empty_countries: emptyCountries.length,
      thin_roles: thinRoles.map((r) => r.slug),
      validation_issues: content.issues.length,
    },
    categories,
    countries: countries.filter((c) => c.links > 0 || c.coverage > 0),
    roles,
  };
}
