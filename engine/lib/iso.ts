import type { Country } from './schema.ts';

export type Region = NonNullable<Country['region']>;

/**
 * Country registry seed, grouped by region.
 *
 * Codes are ISO 3166-1 alpha-2. Names are NOT hard-coded here — they come
 * from `Intl.DisplayNames`, which Node ships with full ICU data. That means
 * the English name is always correct, and a future locale needs no data change,
 * just a different `locale` argument.
 *
 * Coverage is the ~120 countries an expat is plausibly relocating to or passing
 * through. It is not all 249: `make add-country CODE=xx` adds more, and the
 * map renders every country from TopoJSON regardless of what is registered.
 * A registered country with no links renders as an empty page, which is worse
 * than not offering it in the picker, so the seed is deliberately not
 * exhaustive.
 */
const BY_REGION: Record<Region, string[]> = {
  europe: [
    'al', 'ad', 'at', 'by', 'be', 'ba', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fo', 'fi', 'fr',
    'de', 'gi', 'gr', 'hu', 'is', 'ie', 'im', 'it', 'lv', 'li', 'lt', 'lu', 'mt', 'md', 'mc',
    'me', 'nl', 'mk', 'no', 'pl', 'pt', 'ro', 'ru', 'sm', 'rs', 'sk', 'si', 'es', 'se', 'ch',
    'ua', 'gb', 'va', 'ax',
  ],
  'middle-east': ['bh', 'eg', 'il', 'iq', 'jo', 'kw', 'lb', 'om', 'qa', 'sa', 'tr'],
  asia: [
    'af', 'am', 'az', 'bd', 'bt', 'bn', 'kh', 'cn', 'ge', 'hk', 'in', 'id', 'jp', 'kz', 'kp',
    'kr', 'la', 'my', 'mv', 'mn', 'mm', 'np', 'ph', 'sg', 'lk', 'th', 'tj', 'tl', 'tm', 'tw', 'uz',
    'vn',
  ],
  africa: [
    'dz', 'ao', 'bw', 'cm', 'cv', 'ke', 'gh', 'ma', 'mz', 'ng', 'rw', 'sn', 'sc', 'za', 'tz',
    'ug', 'zm',
  ],
  americas: [
    'ar', 'bb', 'bs', 'br', 'ca', 'cl', 'co', 'cr', 'cu', 'do', 'ec', 'sv', 'gt', 'ht', 'hn',
    'jm', 'mx', 'ni', 'pa', 'py', 'pe', 'kn', 'lc', 'vc', 'tt', 'us', 'uy', 've',
  ],
  oceania: ['au', 'fj', 'ki', 'mh', 'fm', 'nr', 'nc', 'nz', 'pw', 'pg', 'ws', 'sb', 'to', 'vu'],
};

const REGION_ORDER: Region[] = ['europe', 'middle-east', 'asia', 'africa', 'americas', 'oceania'];

const display = new Intl.DisplayNames(['en'], { type: 'region' });

/** English display name for an ISO code, e.g. `de` -> `Germany`. */
export function countryName(code: string): string {
  const name = display.of(code.toUpperCase());
  if (!name || name === code.toUpperCase()) throw new Error(`not a known ISO 3166-1 alpha-2 code: ${code}`);
  return name;
}

/**
 * Flattened seed rows. `aliases` is left empty; the migration and manual
 * entries fill in legacy spellings where the old README used them.
 */
export function seedCountries(): Country[] {
  const rows: Country[] = [];
  for (const region of REGION_ORDER) {
    for (const code of BY_REGION[region]) {
      rows.push({ name: countryName(code), code, region, aliases: [] });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Codes a `--verify` pass can check against the full ISO list. */
export function allSeedCodes(): string[] {
  return REGION_ORDER.flatMap((region) => BY_REGION[region]);
}
