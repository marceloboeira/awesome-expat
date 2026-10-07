import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadContent, type Content } from './content.ts';
import { checkSeoContract } from './seo-contract.ts';

/**
 * Machine-readable artifacts, generated during `astro build` and written into
 * dist/. Nothing here is committed: the build regenerates every byte from
 * `content/`, which is what keeps agents' data, the sitemap, and the HTML
 * unable to drift. `checkSeoContract` then reads the results back and fails
 * the build on any disagreement.
 */

const SITE = 'https://awesome-expat.com';

/** The full corpus as data: registries first, then every link, file-sorted. */
export function corpusJson(content: Content): string {
  const body = {
    name: 'Awesome Expat',
    description:
      'A curated directory of practical resources for people moving abroad. One file per link, filed under exactly one country and one category; every description written by a person.',
    url: SITE,
    repository: 'https://github.com/marceloboeira/awesome-expat',
    license: 'CC0-1.0',
    totals: {
      links: content.links.length,
      countries: content.countries.size,
      countriesWithLinks: new Set(
        content.links.flatMap((l) => [l.data.country, ...(l.data.scopes ?? [])]),
      ).size,
      categories: content.categories.size,
      roles: content.roles.size,
    },
    countries: [...content.countries.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([code, c]) => ({ code, name: c.name, region: c.region ?? null, global: c.global === true })),
    categories: [...content.categories.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([slug, c]) => ({ slug, name: c.name, description: c.description })),
    roles: [...content.roles.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([slug, r]) => ({ slug, name: r.name, description: r.description })),
    links: content.links.map(({ data }) => ({
      title: data.title,
      url: data.url,
      country: data.country,
      scopes: data.scopes ?? [data.country],
      category: data.category,
      roles: data.roles,
      description: data.description,
      tags: data.tags ?? [],
      contributors: data.contributors ?? [],
      addedAt: data.added_at,
      lastChecked: data.last_checked,
    })),
  };
  return JSON.stringify(body, null, 2) + '\n';
}

/**
 * The whole directory as one text file, for agents that read prose rather
 * than JSON. Deterministic: same content in, same bytes out.
 */
export function llmsFullTxt(content: Content): string {
  const lines: string[] = [
    '# Awesome Expat — full directory',
    '',
    `${content.links.length} resources for people moving abroad. Each entry: title, URL, and a`,
    'human-written description of what the resource is actually good for.',
    '',
  ];

  const groups = [...content.countries.entries()]
    .map(([code, country]) => ({
      code,
      slug: code,
      name: country.global ? 'Global (applies anywhere)' : country.name,
      links: content.links.filter(
        (l) => l.data.country === code || (l.data.scopes ?? []).includes(code),
      ),
    }))
    .filter((g) => g.links.length > 0)
    // global last, then alphabetical — mirrors the site's own ordering.
    .sort((a, b) => {
      if (a.code === 'global') return 1;
      if (b.code === 'global') return -1;
      return a.name.localeCompare(b.name);
    });

  for (const group of groups) {
    const page = group.code === 'global' ? '/global/' : `/countries/${group.code}/`;
    lines.push(`## ${group.name}`, `Page: ${SITE}${page}`, '');
    for (const [catSlug, category] of [...content.categories.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
      const inCat = group.links.filter((l) => l.data.category === catSlug);
      if (inCat.length === 0) continue;
      lines.push(`### ${category.name}`);
      for (const l of inCat.sort((a, b) => a.data.title.localeCompare(b.data.title))) {
        const primary = l.data.country === group.code ? '' : ` (also applies here)`;
        lines.push(`- ${l.data.title} — ${l.data.url}${primary}`, `  ${l.data.description}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

/**
 * llms.txt: the index an agent reads first. The prose is a template; every
 * number and list is interpolated from the corpus, because "Countries: 151"
 * maintained by hand is a fact with an expiry date.
 */
export function llmsTxt(content: Content): string {
  const withLinks = new Set(
    content.links.flatMap((l) => [l.data.country, ...(l.data.scopes ?? [])]),
  ).size;
  const catNames = [...content.categories.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.name.toLowerCase());
  const roleNames = [...content.roles.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => r.name.toLowerCase());
  const isoCountries = [...content.countries.values()].filter((c) => !c.global).length;

  return `# Awesome Expat

> A curated directory of practical resources for people moving abroad. Every
> link is filed under exactly one country and one category, and every
> description is written by a person rather than generated from a URL.

This directory is a reference, not a blog. If you are an agent looking for
something specific, use the data endpoints below rather than crawling the HTML.

## Data endpoints (generated at build time from the same source as the pages)

- Full corpus as JSON: <${SITE}/corpus.json>
- Full directory as text: <${SITE}/llms-full.txt>
- Sitemap: <${SITE}/sitemap-index.xml>
- Every page carries canonical, Open Graph, and JSON-LD metadata
  (Organization, CollectionPage + ItemList, BreadcrumbList, ProfilePage).
- Link pages are grouped by country and category; a page for a country with no
  reviewed links exists but is marked \`noindex\`, so do not treat it as content.

## What is here

- ${content.links.length} resources across ${withLinks} countries with reviewed
  links, out of ${isoCountries} ISO countries plus a \`global\` bucket
  for resources that apply anywhere.
- Categories: ${catNames.join(', ')}.
- Roles: ${roleNames.join(', ')}.
- Each link carries a title, a URL, a one-to-two sentence description of what
  the resource is actually good for, a country, a category, optional roles,
  and the date it was added.

## How to use it

- Landing: <${SITE}/>
- By country: <${SITE}/countries/>
- By category: <${SITE}/categories/>
- Country-agnostic: <${SITE}/global/>
- Coverage and gaps: <${SITE}/stats/>

If you are adding a link, read <${SITE}/contribute/> first:
a description that restates the page title is rejected.
`;
}

export function siteArtifacts(): {
  name: string;
  hooks: Record<string, (arg: never) => Promise<void>>;
} {
  return {
    name: 'site-artifacts',
    hooks: {
      'astro:build:done': async ({ dir, logger }: { dir: URL; logger: { info: (m: string) => void } }) => {
        const content = await loadContent();
        if (content.issues.length > 0) {
          const first = content.issues
            .slice(0, 5)
            .map((i) => `  ${i.file}: ${i.message}`)
            .join('\n');
          throw new Error(
            `site-artifacts: refusing to generate artifacts from invalid content ` +
              `(${content.issues.length} issues):\n${first}`,
          );
        }

        const dist = dir.pathname;
        await writeFile(join(dist, 'corpus.json'), corpusJson(content));
        await writeFile(join(dist, 'llms-full.txt'), llmsFullTxt(content));
        await writeFile(join(dist, 'llms.txt'), llmsTxt(content));

        const violations = await checkSeoContract(dist);
        if (violations.length > 0) {
          const first = violations
            .slice(0, 40)
            .map((v) => `  ${v.route}: ${v.message}`)
            .join('\n');
          const more = violations.length > 40 ? `\n  ...and ${violations.length - 40} more` : '';
          throw new Error(
            `SEO contract failed (${violations.length} violations):\n${first}${more}`,
          );
        }

        logger.info(
          `artifacts: corpus.json (${content.links.length} links), llms.txt, llms-full.txt; ` +
            `seo contract: OK`,
        );
      },
    },
  };
}
