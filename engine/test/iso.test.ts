import { countryName, seedCountries, allSeedCodes } from '../lib/iso.ts';

/**
 * Tests for the ISO country lookup behind `make add-country`.
 *
 * The failure this guards against is silent and expensive: `Intl.DisplayNames`
 * invents a plausible name for any well-formed code, so a typo used to produce
 * a registry entry called "Unknown Region" that passed validation and shipped.
 * A country page with a nonsense name is worse than a missing one, because
 * nothing downstream can tell that the name was never checked.
 */
export const name = 'iso';
export type Check = (label: string, actual: unknown, expected: unknown) => void;

export async function run(check: Check) {
  // Real codes resolve, including ones whose CLDR name is not the obvious one.
  check('resolves a common code', countryName('de'), 'Germany');
  check('resolves the UK', countryName('gb'), 'United Kingdom');
  check('resolves a code added after the seed', countryName('pt'), 'Portugal');
  check('is case-insensitive', countryName('CH'), 'Switzerland');

  // Unassigned but well-formed codes must throw, not invent a name.
  check('rejects an unassigned code', (() => { try { countryName('xx'); return 'accepted'; } catch { return 'rejected'; } })(), 'rejected');
  check('rejects another unassigned code', (() => { try { countryName('qq'); return 'accepted'; } catch { return 'rejected'; } })(), 'rejected');

  // ZZ is the regression: CLDR assigns it the real string "Unknown Region", so
  // it survives the "did we get a name back" check. It must still be rejected.
  check('rejects CLDR placeholder territory ZZ', (() => { try { countryName('zz'); return 'accepted'; } catch { return 'rejected'; } })(), 'rejected');

  // The seed must not itself contain anything the lookup would reject, and no
  // entry may be left without a real name.
  const seeded = seedCountries();
  check('seed is non-empty', seeded.length > 100, true);
  check('every seeded country has a name that is not the code', seeded.every((c) => c.name !== c.code.toUpperCase()), true);
  check('no seeded country is ZZ', seeded.some((c) => c.code === 'zz'), false);
  check('seed codes are all two letters', allSeedCodes().every((c) => /^[a-z]{2}$/.test(c)), true);
}
