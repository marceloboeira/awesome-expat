import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, loadContent } from '../lib/content.ts';
import { countryName } from '../lib/iso.ts';
import { writeYaml } from '../lib/write.ts';
import { regionSchema } from '../lib/schema.ts';

/**
 * Register a country that is not in the seed.
 *
 * Region is required and has no default, because guessing it produces a
 * country that sorts into the wrong section of the map and the wrong sitemap
 * group. The `global` pseudo-country is the only entry allowed to skip it.
 */
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const REGIONS = ['europe', 'asia', 'africa', 'americas', 'oceania', 'middle-east'] as const;

async function main() {
  const code = (arg('code') ?? process.argv[2])?.toLowerCase();
  if (!code) {
    console.error('usage: make add-country CODE=pt --region=europe');
    process.exit(1);
  }
  if (!/^[a-z]{2}$/.test(code)) {
    console.error(`"${code}" is not a lowercase ISO 3166-1 alpha-2 code`);
    process.exit(1);
  }

  const path = join(ROOT, `content/countries/${code}.yaml`);
  try {
    await access(path);
    console.error(`${code} is already registered: content/countries/${code}.yaml`);
    process.exit(1);
  } catch {
    /* not present, good */
  }

  let name: string;
  try {
    name = countryName(code);
  } catch (cause) {
    console.error(`not a known ISO country: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  }

  const region = arg('region');
  if (!region || !REGIONS.includes(region as (typeof REGIONS)[number])) {
    console.error(`--region is required. One of: ${REGIONS.join(' ')}`);
    console.error(`For ${name} that is most likely: ${REGIONS.filter((r) => plausibleRegion(r, code)).join(', ')}`);
    process.exit(1);
  }

  await writeYaml(`content/countries/${code}.yaml`, { name, code, region, aliases: [] });
  console.log(`created content/countries/${code}.yaml — ${name} (${region})`);

  // Confirm the registry still loads clean, so a typo cannot land unnoticed.
  const content = await loadContent();
  const errors = content.issues.filter((i) => i.kind === 'cross-reference' || i.kind === 'countries');
  if (errors.length) {
    console.error('\nthe registry did not load clean:');
    for (const issue of errors) console.error(`  ${issue.file}: ${issue.message}`);
    process.exit(1);
  }
  console.log('registry still validates');
}

/** A rough hint only, so the error message can suggest something. */
function plausibleRegion(region: string, code: string): boolean {
  const hints: Record<string, string[]> = {
    europe: ['gb', 'ie', 'fr', 'de', 'it', 'es', 'pt', 'nl', 'se', 'no', 'pl', 'ua', 'is', 'mt', 'cy', 'ad', 'sm', 'mc', 'li', 'va', 'ax', 'fo', 'gi', 'im', 'je', 'gg', 'je'],
    'middle-east': ['tr', 'il', 'ae', 'sa', 'qa', 'kw', 'bh', 'om', 'jo', 'lb', 'iq', 'ir', 'eg'],
    oceania: ['au', 'nz', 'fj', 'pg', 'nc', 'vu', 'sb', 'ws', 'to', 'ki', 'nr', 'tv', 'fm', 'mh', 'pw', 'ck', 'nu', 'pf', 'tk', 'gu', 'mp', 'as'],
    americas: ['us', 'ca', 'mx', 'br', 'ar', 'cl', 'co', 'pe', 've', 'ec', 'uy', 'py', 'bo', 'cu', 'do', 'gt', 'hn', 'sv', 'ni', 'cr', 'pa', 'jm', 'ht', 'pr'],
    asia: ['jp', 'cn', 'kr', 'in', 'id', 'th', 'vn', 'ph', 'my', 'sg', 'hk', 'tw', 'pk', 'bd', 'lk', 'np', 'kz', 'uz', 'il', 'af', 'kz'],
    africa: ['za', 'ng', 'eg', 'ke', 'ma', 'gh', 'tn', 'dz', 'et', 'tz', 'ug', 'zw', 'zm', 'sn', 'ci', 'cm', 'mu', 'bw', 'na', 'ao'],
  };
  return (hints[region] ?? []).includes(code);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
