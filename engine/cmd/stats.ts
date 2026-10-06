import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { loadContent, ROLE_PAGE_THRESHOLD } from '../lib/content.ts';
import { computeStats } from '../lib/stats.ts';
import { SITE } from '../lib/lib-urls.ts';

/**
 * Statistics over the whole directory.
 *
 * Answers the questions that decide what to work on next: which countries and
 * categories are empty, which role pages are too thin to publish, and how much
 * of the corpus is verified versus stubbed.
 *
 * Counts are computed from `content/` by the same loader the site and the
 * validator use, so the numbers cannot disagree with what ships. Nothing here
 * is estimated or cached.
 */

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [k, v = 'true'] = arg.replace(/^--/, '').split('=');
  args.set(k!, v);
}
const FORMAT = args.get('format') ?? 'text';
const OUT = args.get('out');

async function main(): Promise<void> {
  const content = await loadContent();
  const summary = { generated_at: new Date().toISOString(), ...computeStats(content) };

  if (FORMAT === 'json') {
    const json = JSON.stringify(summary, null, 2);
    if (OUT) {
      await mkdir('.agents', { recursive: true });
      await writeFile(OUT, json + '\n', 'utf8');
      console.log(`stats: wrote ${OUT}`);
    } else {
      console.log(json);
    }
    return;
  }

  // ---- text report ------------------------------------------------------
  const pad = (n: number | string, w: number) => String(n).padStart(w);
  const pct = (n: number, d: number) => (d === 0 ? '-' : `${Math.round((n / d) * 100)}%`);

  console.log(`\n  ${SITE} — directory statistics  (${summary.generated_at.slice(0, 10)})\n`);
  console.log(`  ${'TOTALS'.padEnd(30)}${'count'.padStart(6)}`);
  const t = summary.totals;
  const rows: [string, number][] = [
    ['links', t.links],
    ['countries (registered / with links)', t.countries_registered],
    ['  ...of which have links', t.countries_with_links],
    ['categories (with links)', t.categories],
    ['  ...of which have links', t.categories_with_links],
    ['groups', t.groups],
    ['roles', t.roles],
    ['authors', t.authors],
    ['posts', t.posts],
    ['global links', t.global_links],
    ['multi-country (scoped) links', t.scoped_links],
    ['featured', t.featured],
    ['tagged', t.tagged],
    ['with contributors', t.with_contributors],
    ['verified descriptions', t.verified_descriptions],
    ['unverified descriptions', t.unverified_descriptions],
    ['non-canonical URLs', t.non_canonical_urls],
    ['duplicate URLs', t.duplicate_urls],
  ];
  for (const [label, value] of rows) console.log(`  ${label.padEnd(30)}${pad(value, 6)}`);

  console.log(`\n  CATEGORIES  (${t.categories_with_links}/${t.categories} with links)`);
  console.log(`  ${'slug'.padEnd(22)}${'links'.padStart(6)}${'verified'.padStart(10)}${'countries'.padStart(11)}`);
  for (const c of summary.categories) {
    const flag = c.links === 0 ? '  <- empty' : '';
    console.log(
      `  ${c.slug.padEnd(22)}${pad(c.links, 6)}${pad(c.verified + '/' + pct(c.verified, c.links || 1), 10)}${pad(c.coverage, 11)}${flag}`,
    );
  }

  console.log(`\n  COUNTRIES WITH LINKS  (${t.countries_with_links} of ${t.countries_registered} registered)`);
  console.log(`  ${'code'.padEnd(8)}${'name'.padEnd(26)}${'links'.padStart(6)}${'categories'.padStart(11)}`);
  for (const c of summary.countries) {
    console.log(`  ${c.slug.padEnd(8)}${c.name.slice(0, 25).padEnd(26)}${pad(c.links, 6)}${pad(c.coverage, 11)}`);
  }

  console.log(`\n  ROLES  (>= ${ROLE_PAGE_THRESHOLD} applicable links to publish)`);
  console.log(`  ${'slug'.padEnd(22)}${'specific'.padStart(9)}${'general'.padStart(8)}${'publish'.padStart(9)}`);
  for (const r of summary.roles) {
    const flag = r.publishable ? '' : '  <- below threshold, no page';
    console.log(`  ${r.slug.padEnd(22)}${pad(r.specific, 9)}${pad(r.general, 8)}${pad(r.publishable ? 'yes' : 'no', 9)}${flag}`);
  }

  console.log('\n  COVERAGE GAPS');
  if (summary.quality.empty_categories.length > 0) {
    console.log(`    empty categories (${summary.quality.empty_categories.length}): ${summary.quality.empty_categories.join(', ')}`);
  } else {
    console.log('    every category has at least one link');
  }
  console.log(`    countries with no links: ${summary.quality.empty_countries} of ${t.countries_registered}`);
  console.log(
    `    descriptions still unverified: ${t.unverified_descriptions} of ${t.links} (${pct(t.unverified_descriptions, t.links)})`,
  );
  if (summary.quality.thin_roles.length > 0) {
    console.log(`    role pages below the publish threshold: ${summary.quality.thin_roles.join(', ')}`);
  }
  console.log('');
}

main().catch((error: Error) => {
  console.error(`stats failed: ${error.message}`);
  process.exit(1);
});
