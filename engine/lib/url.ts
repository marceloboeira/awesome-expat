/**
 * URL canonicalisation.
 *
 * Deduplication is the whole game here: two links that differ only by
 * `www.`, a trailing slash, or an `utm_source` param are the same link, and
 * letting both through produces duplicate pages competing in search results.
 *
 * Used by `add-link` to warn on submit and by `validate` to catch duplicates
 * that were hand-edited or merged in from two branches.
 */

/** Query parameters that never change what the page *is*. */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^ref$/i,
  /^ref_/i,
  /^referrer$/i,
  /^source$/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^msclkid$/i,
  /^mc_[ce]id$/i,
  /^igshid$/i,
  /^_ga$/i,
  /^yclid$/i,
  /^si$/i,
];

/**
 * Reduce a URL to a comparable identity.
 *
 * Returns `null` for anything unparseable, so callers can skip rather than
 * throw on a malformed entry mid-run.
 */
export function normaliseUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  url.username = '';
  url.password = '';

  // Drop default ports; `https://x.com:443/` and `https://x.com/` are one URL.
  if (url.port === '80' || url.port === '443') url.port = '';

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) {
      url.searchParams.delete(key);
    }
  }

  // Sort the remaining params so `?b=2&a=1` and `?a=1&b=2` produce one
  // identity. Without this, the dedup key treats two spellings of the same
  // page as two links -- found by the idempotency suite, not by inspection.
  url.searchParams.sort();

  // `?` and `&` left behind by deletions are noise.
  url.search = url.searchParams.toString();

  // A path of `/` is the same page as ``. Assigning '' is not enough:
  // `URL.toString()` re-adds the slash for http(s) origins, so it has to come
  // off the serialised string instead.
  let output = url.toString();
  if (url.pathname === '/' && url.search === '' && url.hash === '') {
    output = output.replace(/\/$/, '');
  }
  // Collapse a trailing slash on any other path.
  else if (url.pathname !== '/') {
    output = output.replace(/\/(?=$|\?)/, '');
  }

  return output;
}

/** True when the input differs from its own canonical form. */
export function isNonCanonical(input: string): boolean {
  const normalised = normaliseUrl(input);
  return normalised !== null && normalised !== input;
}

/**
 * Derive a stable id from a title, e.g. "Berlin Apartment Finder" ->
 * `berlin-apartment-finder`.
 *
 * Transliterates common accents so the slug stays ASCII and URL-safe. The
 * result is a candidate, not a guarantee — if it collides, `add-link` appends
 * a short suffix and the author confirms it.
 */
export function slugifyTitle(title: string): string {
  const transliterated = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return transliterated.slice(0, 60).replace(/-+$/, '');
}
