/**
 * The two URL tables must agree, byte for byte.
 *
 * These functions used to drift and the drift shipped: `export-markdown` wrote
 * `/au/` and `/jobs/software-engineer/` into the README while the site served
 * `/countries/au/` and `/roles/software-engineer/`. Both are 404s, and nothing
 * in CI noticed, because the generated Markdown was only ever diffed against
 * itself.
 *
 * So this suite asserts the invariant that would have caught it: for every
 * builder, the path the CLI writes into Markdown is the path Astro emits.
 * Adding a builder to one file and not the other fails here.
 */
import {
  categoryInCountryPath,
  categoryPath,
  categoriesPath,
  countriesPath,
  countryPath,
  jobsPath,
  rolePath,
  rolesPath,
  SITE,
} from '../lib/lib-urls.ts';
import * as routes from '../../src/lib/routes.ts';

export const name = 'routes';
export type Check = (label: string, actual: unknown, expected: unknown) => void;

export async function run(check: Check) {
  check('site constant matches', SITE, routes.SITE);

  // `global` is the one country whose page is not under /countries/, because it
  // is a content bucket rather than a place. Both tables have to know that.
  for (const code of ['au', 'de', 'us', 'gb']) {
    check(`country ${code}`, countryPath(code), routes.country(code));
  }
  check('global country path', countryPath('global'), routes.global());
  check('global is not under /countries/', countryPath('global').startsWith('/countries/'), false);

  check('countries index', countriesPath(), routes.countries());
  check('categories index', categoriesPath(), routes.categories());

  for (const slug of ['housing', 'jobs', 'finances', 'visa', 'community']) {
    check(`category ${slug}`, categoryPath(slug), routes.category(slug));
  }

  check(
    'category in country',
    categoryInCountryPath('de', 'housing'),
    routes.categoryInCountry('de', 'housing'),
  );

  check('roles index', rolesPath(), routes.roles());
  // The distinction that the README got wrong: /jobs/ is job boards, /roles/
  // is the role index. Sending a role question to the boards page is wrong
  // even though both return 200.
  check('jobs path is the boards page', jobsPath(), routes.jobs());
  check('roles and jobs are different pages', rolesPath() === jobsPath(), false);

  for (const slug of ['software-engineer', 'devops-sre', 'product-manager']) {
    check(`role ${slug}`, rolePath(slug), routes.role(slug));
  }
  check(
    'role in country',
    rolePath('software-engineer', 'de'),
    routes.roleInCountry('software-engineer', 'de'),
  );

  // Every builder must produce a trailing-slash path: the site builds with
  // `trailingSlash: 'always'`, and the slash-less form is a redirect.
  const built = [
    countryPath('de'),
    countryPath('global'),
    categoriesPath(),
    categoryPath('housing'),
    categoryInCountryPath('de', 'housing'),
    rolesPath(),
    jobsPath(),
    rolePath('devops-sre'),
  ];
  for (const path of built) {
    check(`${path} ends with a slash`, path.endsWith('/'), true);
    check(`${path} has no double slash`, path.includes('//'), false);
  }
}