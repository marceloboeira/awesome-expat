import { loadContent, linksForCountry, linksForRole, ROLE_PAGE_THRESHOLD } from '../lib/content.ts';
import { normaliseUrl } from '../lib/url.ts';
import type { Check } from './schema.test.ts';

export const name = 'content';

export async function run(check: Check) {
  const content = await loadContent();

  check('no cross-reference errors', content.issues.filter((i) => i.kind === 'cross-reference').length, 0);
  check('no duplicate URLs', content.issues.filter((i) => i.message.includes('duplicate')).length, 0);
  check('link dirs match country', content.issues.filter((i) => i.message.includes('does not match directory')).length, 0);
  check('global pseudo-country exists', content.countries.has('global'), true);
  check('no TODO descriptions', content.links.filter((l) => l.data.description.startsWith('TODO')).length, 0);
  // Every migrated description is machine-written and unreviewed, so all 67
// are unverified. The schema default was flipped from true to false after
// this test caught it reporting 67/67 as verified. Reviewing these is
// tracked as outstanding work, not asserted as done.
check('no description claims verification it does not have', content.links.filter((l) => l.data.description_verified === false).length, content.links.length);
  check('all links use https', content.links.filter((l) => !(l.data.url as string).startsWith('https://')).length, 0);
  check('all links are canonical', content.links.filter((l) => normaliseUrl(l.data.url as string) !== l.data.url).length, 0);
  check('no unknown category refs', content.issues.filter((i) => i.message.includes('unknown category')).length, 0);
  check('no unknown role refs', content.issues.filter((i) => i.message.includes('unknown role')).length, 0);

  // A link filed under `de` but scoped to `it` must surface on the Italy page.
  const actero = content.links.find((l) => l.data.title === 'Actero');
  check('actero exists', Boolean(actero), true);
  check('actero filed under de', actero?.data.country, 'de');
  check('actero on de page', linksForCountry(content, 'de').some((l) => l.data.title === 'Actero'), true);
  check('actero on it via scopes', linksForCountry(content, 'it').some((l) => l.data.title === 'Actero'), true);
  check('actero on gb via scopes', linksForCountry(content, 'gb').some((l) => l.data.title === 'Actero'), true);
  check('actero is one file, not five', content.links.filter((l) => l.data.title === 'Actero').length, 1);
  check('actero absent from jp', linksForCountry(content, 'jp').some((l) => l.data.title === 'Actero'), false);

  // A scoped link must not inflate its own country beyond the scoped set.
  const no = linksForCountry(content, 'no');
  const nordic = content.links.filter((l) => (l.data.scopes ?? []).includes('no'));
  check('norway has scoped links', nordic.length > 0, true);
  check('norway page shows its scoped links', no.length >= nordic.length, true);

  // Empty roles means "everyone", per decision D-4.
  const general = content.links.filter((l) => l.data.roles.length === 0);
  check('role-agnostic links exist', general.length > 0, true);
  check('role page includes general links', linksForRole(content, 'product-manager').length >= general.length, true);
  check('general link on every role page', linksForRole(content, 'devops-sre').includes(general[0]!), true);
  check('threshold is 3', ROLE_PAGE_THRESHOLD, 3);
}
