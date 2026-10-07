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

/**
 * GitHub is where contributing happens. There is no web form and no database,
 * and that is deliberate: a link is content, and content belongs in version
 * control. These builders keep every "contribute" affordance pointing at the
 * same repository, for the same reason the route builders below keep internal
 * links consistent -- a hand-typed URL is one that can rot out of sync.
 *
 * The exporter keeps its own `REPO` in `engine/cmd/export-markdown.ts`; the
 * branch and owner must match what it writes into the generated Markdown.
 */
export const REPO = 'https://github.com/marceloboeira/awesome-expat';
export const REPO_BRANCH = 'main';

const trimSlashes = (path: string) => path.replace(/^\/+/, '').replace(/\/+$/, '');

export const repo = () => REPO;
export const repoIssues = () => `${REPO}/issues`;
export const repoNewIssue = () => `${REPO}/issues/new`;
export const contributingGuide = () => `${REPO}/blob/${REPO_BRANCH}/CONTRIBUTING.md`;
/** GitHub's web editor: opens a fork to create a new file under `dir`. */
export const repoNewFile = (dir: string) => `${REPO}/new/${REPO_BRANCH}/${trimSlashes(dir)}`;
/** Read a file or directory in the repository tree. */
export const repoTree = (path: string) => `${REPO}/blob/${REPO_BRANCH}/${trimSlashes(path)}`;

export const home = () => '/';
export const countries = () => '/countries/';
export const categories = () => '/categories/';
export const global = () => '/global/';
export const jobs = () => '/jobs/';
export const roles = () => '/roles/';
export const search = () => '/search/';
export const blog = () => '/blog/';
export const contribute = () => '/contribute/';
export const about = () => '/about/';
export const stats = () => '/stats/';
export const contributors = () => '/contributors/';

export const country = (code: string) => `/countries/${code}/`;
export const category = (slug: string) => `/categories/${slug}/`;
export const categoryInCountry = (countrySlug: string, categorySlug: string) =>
  `/countries/${countrySlug}/${categorySlug}/`;
export const role = (slug: string) => `/roles/${slug}/`;
export const roleInCountry = (roleSlug: string, countrySlug: string) => `/roles/${roleSlug}/${countrySlug}/`;
export const group = (slug: string) => `/groups/${slug}/`;
export const post = (slug: string) => `/blog/${slug}/`;
export const author = (handle: string) => `/authors/${handle}/`;
export const contributor = (handle: string) => `/contributors/${handle}/`;

/** A contributor's GitHub profile. `handle` is already a normalised username. */
export const githubProfile = (handle: string) => `https://github.com/${handle}`;

export const categorySlug = (c: Category) => c.slug;
export const roleSlug = (r: Role) => r.slug;
export const groupSlug = (g: Group) => g.slug;
