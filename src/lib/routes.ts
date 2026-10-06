import type { Country, Category, Group, Role } from '@engine/schema.ts';

/**
 * Route builders, derived from the same slugs the content files use.
 *
 * Every URL in the site is produced here, so a route cannot disagree with the
 * registry entry that names it. The engine's Markdown exporter keeps its own
 * copies in `engine/lib/lib-urls.ts` for the same reason: the generated docs
 * and the built site must link to the same places.
 */
export const SITE = 'https://awesome-expat.com';

export const home = () => '/';
export const countries = () => '/countries';
export const categories = () => '/categories';
export const global = () => '/global';
export const jobs = () => '/jobs';
export const roles = () => '/roles';
export const search = () => '/search';
export const blog = () => '/blog';
export const contribute = () => '/contribute';
export const about = () => '/about';
export const stats = () => '/stats';

export const country = (code: string) => `/countries/${code}`;
export const category = (slug: string) => `/categories/${slug}`;
export const categoryInCountry = (countrySlug: string, categorySlug: string) =>
  `/countries/${countrySlug}/${categorySlug}`;
export const role = (slug: string) => `/roles/${slug}`;
export const roleInCountry = (roleSlug: string, countrySlug: string) => `/roles/${roleSlug}/${countrySlug}`;
export const group = (slug: string) => `/groups/${slug}`;
export const post = (slug: string) => `/blog/${slug}`;
export const author = (handle: string) => `/authors/${handle}`;

export const categorySlug = (c: Category) => c.slug;
export const roleSlug = (r: Role) => r.slug;
export const groupSlug = (g: Group) => g.slug;
