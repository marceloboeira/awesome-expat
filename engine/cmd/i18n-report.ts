import { loadContent } from '../lib/content.ts';
import { categoryPath, countryPath, rolePath } from '../lib/lib-urls.ts';

/**
 * What needs translating before a second locale can launch.
 *
 * The site ships English only, but the schema already carries the fields a
 * translation would need. This report exists so "add German" is a known
 * quantity rather than an archaeology project, and so a locale is never
 * launched as a partial duplicate of the English tree.
 */

interface Row {
  kind: string;
  id: string;
  source: string;
  fields: string;
  route: string;
}

const LOCALES = ['en', 'pt', 'es', 'de', 'fr'] as const;

async function main() {
  const content = await loadContent();
  const rows: Row[] = [];

  for (const [code, country] of content.countries) {
    if (country.global) continue;
    const fields = ['name', country.description ? 'description' : ''].filter(Boolean).join(', ');
    rows.push({ kind: 'country', id: code, source: `content/countries/${code}.yaml`, fields, route: countryPath(code) });
  }

  for (const [slug, category] of content.categories) {
    rows.push({ kind: 'category', id: slug, source: `content/categories/${slug}.yaml`, fields: 'name, description', route: categoryPath('<country>', slug) });
  }

  for (const [slug, group] of content.groups) {
    rows.push({ kind: 'group', id: slug, source: `content/groups/${slug}.yaml`, fields: 'name, description', route: `/groups/${slug}/` });
  }

  for (const [slug, role] of content.roles) {
    rows.push({ kind: 'role', id: slug, source: `content/roles/${slug}.yaml`, fields: 'name, description', route: rolePath(slug) });
  }

  // Link descriptions are the bulk of the translation work and are the reason
  // this is a real project rather than a config flag.
  for (const { data, file } of content.links) {
    rows.push({ kind: 'link', id: data.title.slice(0, 40), source: file, fields: 'title, description, tags', route: countryPath(data.country) });
  }

  const byKind = new Map<string, number>();
  for (const row of rows) byKind.set(row.kind, (byKind.get(row.kind) ?? 0) + 1);

  console.log('i18n readiness\n');
  console.log('  Target locales   ', LOCALES.join(', '));
  console.log('  Current          en only');
  console.log('  Prefix strategy  /<locale>/<path>  (default locale unprefixed)');
  console.log('  Strings to write ', rows.length);
  console.log();
  for (const [kind, count] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(10)} ${String(count).padStart(4)}`);
  }

  console.log('\nby kind, with what needs translating:');
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.kind)) continue;
    seen.add(row.kind);
    console.log(`  ${row.kind.padEnd(10)} ${row.fields.padEnd(24)} e.g. ${row.route}`);
  }

  console.log('\nnot yet in place (needed before a second locale):');
  for (const gap of [
    'a translations/ directory with <locale>.json lookup tables for UI chrome',
    'hreflang <link> tags in the head, built from the same route table',
    'x-default pointing at the unprefixed English route',
    'a locale switcher in the header',
    'per-locale country and category display names (Intl.DisplayNames covers country names, not our own copy)',
  ]) {
    console.log(`  - ${gap}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
