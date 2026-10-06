import { loadContent, linksForCountry, type ValidationIssue } from '../lib/content.ts';
import { isNonCanonical } from '../lib/url.ts';
import { repoRelative } from '../lib/write.ts';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../lib/content.ts';
import { normaliseUrl } from '../lib/url.ts';

const SEVERITY = { error: '✗', warn: '⚠', info: '·' } as const;
type Severity = keyof typeof SEVERITY;

interface Report {
  severity: Severity;
  kind: string;
  file: string;
  path: string;
  message: string;
}

const reports: Report[] = [];
const add = (severity: Severity, kind: string, file: string, path: string, message: string) =>
  reports.push({ severity, kind, file, path, message });

async function main() {
  const content = await loadContent();

  // --- Schema + cross-reference errors (already collected by loadContent) ---
  for (const issue of content.issues) {
    add('error', issue.kind, issue.file, issue.path, issue.message);
  }

  // --- Soft checks -------------------------------------------------------
  const unreviewed: string[] = [];
  for (const { data, file } of content.links) {
    if (isNonCanonical(data.url)) {
      const canonical = normaliseUrl(data.url);
      add('warn', 'links', file, 'url', `not canonical — prefer ${canonical}`);
    }
    if (data.description_verified === false) unreviewed.push(file);
    const scopeCount = data.scopes?.length ?? 1;
    if (scopeCount > 1) {
      add('info', 'links', file, 'scopes', `appears on ${scopeCount} country pages`);
    }
  }

  /**
   * Unreviewed descriptions are reported as one aggregate note, not a warning
   * per link. Every migrated description is machine-drafted and unreviewed, so
   * per-file warnings made all 67 of them a warning and buried the checks that
   * can actually fail -- a non-canonical URL, a dead reference, a schema
   * violation. "Unreviewed" is a state of the content, which /stats and the
   * "awaiting review" marker on the site already surface per link, not a
   * defect that `make check` should be failing on.
   */
  if (unreviewed.length > 0) {
    add(
      'info',
      'links',
      unreviewed.length === content.links.length ? '(all)' : '(partial)',
      'description_verified',
      `${unreviewed.length} of ${content.links.length} descriptions are machine-drafted and unreviewed` +
        (unreviewed.length === content.links.length ? ' — run `make stats` for the breakdown' : ''),
    );
  }

  // --- Empty pages -------------------------------------------------------
  for (const [slug, country] of content.countries) {
    const links = linksForCountry(content, slug);
    if (links.length === 0) {
      add('info', 'countries', `content/countries/${slug}.yaml`, '(page)', `${country.name} has no links yet`);
    }
  }

  // --- Registry hygiene --------------------------------------------------
  // Countries with no links are normal early on (the seed covers 150), so this
  // stays an info note. Once a country has links, the reverse is a real bug:
  // a category in the registry that nothing uses means a dead navigation entry.
  const usedCategories = new Set(content.links.map((l) => l.data.category));
  for (const [slug, category] of content.categories) {
    if (!usedCategories.has(slug)) {
      add('info', 'categories', `content/categories/${slug}.yaml`, '(nav)', `${category.name} has no links yet`);
    }
  }

  for (const [slug, role] of content.roles) {
    const used = content.links.filter((l) => l.data.roles.includes(slug));
    if (used.length === 0) {
      add('info', 'roles', `content/roles/${slug}.yaml`, '(nav)', `${role.name} has no role-specific links yet`);
    }
  }

  const bySeverity = (s: Severity) => reports.filter((r) => r.severity === s);

  // --- Write JSON report for the link checker and CI ---------------------
  const reportDir = join(ROOT, '.agents');
  await writeFile(
    join(reportDir, 'link-report.json'),
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        errors: bySeverity('error').length,
        warnings: bySeverity('warn').length,
        links: content.links.map(({ data, file }) => ({
          file,
          url: data.url,
          country: data.country,
          category: data.category,
          title: data.title,
          last_checked: data.last_checked,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );

  // --- Console output ---------------------------------------------------
  const order: Severity[] = ['error', 'warn', 'info'];
  for (const severity of order) {
    for (const report of bySeverity(severity)) {
      const location = report.path && report.path !== '(page)' ? `${report.file}:${report.path}` : report.file;
      console.log(`${SEVERITY[severity]} ${location}\n    ${report.message}`);
    }
  }

  const errors = bySeverity('error').length;
  const warnings = bySeverity('warn').length;
  const infos = bySeverity('info').length;

  console.log(
    `\n${content.countries.size} countries, ${content.categories.size} categories, ` +
      `${content.groups.size} groups, ${content.roles.size} roles, ` +
      `${content.links.length} links, ${content.posts.length} posts`,
  );
  console.log(`${errors} error(s), ${warnings} warning(s), ${infos} note(s)`);

  if (errors > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
