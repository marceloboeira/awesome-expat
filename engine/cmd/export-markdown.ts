import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, loadContent, linksForCountry, roleHasEnoughLinks, ROLE_PAGE_THRESHOLD } from '../lib/content.ts';
import { SITE, categoriesPath, categoryPath, countriesPath, countryPath, jobsPath, rolePath, rolesPath } from '../lib/lib-urls.ts';
import type { Category } from '../lib/schema.ts';

const REPO = 'https://github.com/marceloboeira/awesome-expat';

/**
 * Generate the GitHub-facing Markdown surface from `content/`.
 *
 * `README.md` and `docs/**` are build artifacts, not sources. Contributors
 * edit YAML; this script is the only thing that writes Markdown, and CI
 * fails if the committed Markdown does not match what this produces. That
 * removes an entire class of "someone edited the README by hand" bugs.
 */

const badge = (label: string, message: string, colour: string) =>
  `[![${label}](https://img.shields.io/badge/${encodeURIComponent(label).replace(/-/g, '--')}-${encodeURIComponent(message).replace(/-/g, '--')}-${colour})](${REPO}/actions)`;

async function main() {
  const content = await loadContent();

  if (content.issues.some((issue) => issue.kind === 'cross-reference' || issue.kind === 'links')) {
    console.error('export: refusing to run with content errors — run `make validate` first');
    process.exit(1);
  }

  const generatedBanner = (path: string) =>
    `<!--\n  AUTO-GENERATED — do not edit by hand.\n  Source: content/links/**\n  Regenerate: make export\n  See: ${path}\n-->`;

  // ---- docs/index.md: country directory --------------------------------
  // The `global` pseudo-country is a real page, but it is not a place, so it
  // sorts last and reads as "everywhere else" rather than sitting in the
  // alphabetical middle of a list of destinations.
  const isGlobal = (slug: string) => content.countries.get(slug)?.global === true;
  const countriesWithLinks = [...content.countries.entries()]
    .filter(([slug]) => linksForCountry(content, slug).length > 0)
    .sort(([a, countryA], [b, countryB]) => {
      if (isGlobal(a) !== isGlobal(b)) return isGlobal(a) ? 1 : -1;
      return countryA.name.localeCompare(countryB.name, 'en');
    });

  const countryRows = countriesWithLinks
    .map(([slug, country]) => {
      const links = linksForCountry(content, slug);
      const categoryCount = new Set(links.map((l) => l.data.category)).size;
      return (
        `| [${country.name}](${SITE}${countryPath(slug)}) | ` +
        `[\`${slug}\`](${REPO}/tree/main/content/links/${slug}) | ${links.length} | ${categoryCount} |`
      );
    })
    .join('\n');

  const indexDoc = `${generatedBanner('CONTRIBUTING.md')}

# Country directory

Every country below has at least one resource. ${content.countries.size} countries are registered in total.

| Country | Slug | Links | Categories |
| --- | --- | ---: | ---: |
${countryRows}

Browse the live site: ${SITE}${countriesPath()}
`;

  // ---- docs/countries/<slug>.md: per-country resource list --------------
  const countryDocs: string[] = [];
  for (const [slug, country] of countriesWithLinks) {
    const links = linksForCountry(content, slug);
    const categories = [...new Set(links.map((l) => l.data.category))]
      .map((slug) => [slug, content.categories.get(slug)] as const)
      .filter((entry): entry is readonly [string, Category] => Boolean(entry[1]))
      .sort(([, a], [, b]) => a.order - b.order);

    const sections = categories
      .map(([categorySlug, category]) => {
        const rows = links
          .filter((l) => l.data.category === categorySlug)
          .sort((a, b) => a.data.title.localeCompare(b.data.title, 'en'))
          .map((l) => {
            const tags = l.data.tags.length ? ` — ${l.data.tags.map((t) => `\`${t}\``).join(' ')}` : '';
            const featured = l.data.featured ? ' ⭐' : '';
            return `- [${l.data.title}](${l.data.url})${featured}  \n  ${l.data.description}${tags}`;
          })
          .join('\n');
        return `### ${category.name}\n\n${rows}`;
      })
      .join('\n\n');

    countryDocs.push(`${generatedBanner(`content/links/${slug}/`)}
# Expat resources for ${country.name}

${country.description ?? `Practical links for people moving to or living in ${country.name}.`}

${links.length} resource${links.length === 1 ? '' : 's'} across ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}.

[Browse on the site](${SITE}${countryPath(slug)})

${sections}
`);
  }

  // ---- docs/jobs.md: role pages ----------------------------------------
  const roleRows = [...content.roles.entries()]
    .map(([slug, role]) => {
      const roleLinks = content.links.filter((l) => l.data.roles.length === 0 || l.data.roles.includes(slug));
      const countries = new Set(roleLinks.map((l) => l.data.country));
      // `roleHasEnoughLinks` is what the site build itself consults, so the
      // "is this page real?" answer cannot drift from the page actually emitted.
      const viable = roleHasEnoughLinks(content, slug);
      // Only link the live page when one was actually published. A thin role is
      // deliberately left unbuilt, and linking it would hand the reader a 404.
      const name = viable
        ? `[${role.name}](${SITE}${rolePath(slug)})`
        : `${role.name} (not published)`;
      return `| ${name} | [\`${slug}\`](${REPO}/tree/main/content/roles/${slug}.yaml) | ${roleLinks.length} | ${countries.size} | ${viable ? 'yes' : `no (< ${ROLE_PAGE_THRESHOLD})`} |`;
    })
    .join('\n');

  const jobsDoc = `${generatedBanner('content/roles/')}

# Roles

Resources filtered by job role. A link with no roles is shown on every role
page, because a general job board is useful to everyone.

${badge('CI', 'passing', 'green')}

| Role | Slug | Links | Countries | Page generated |
| --- | --- | ---: | ---: | --- |
${roleRows}

A role page is only published once it has at least ${ROLE_PAGE_THRESHOLD} links, to avoid thin
duplicate pages competing with each other in search results. Unpublished roles are listed above with
counts but no link, because the page does not exist.

Browse them on the site: ${SITE}${rolesPath()}
`;

  // ---- README.md --------------------------------------------------------
  // Categories are keyed by filename slug, not by a field on the object.
  //
  // Every category page exists, including the two with zero links
  // (`citizenship`, `permanent-residency`). They are noindex and kept out of
  // the sitemap, but they return 200 and say plainly that nothing is there
  // yet, which is a better answer for a reader than a link that 404s.
  const topCategories = [...content.categories.entries()].sort(([, a], [, b]) => a.order - b.order);
  const categoryRows = topCategories
    .map(([slug, category]) => {
      const count = content.links.filter((l) => l.data.category === slug).length;
      return `| [${category.name}](${SITE}${categoryPath(slug)}) | \`${slug}\` | ${count} |`;
    })
    .join('\n');

  const roleCount = content.roles.size;
  const countryCount = countriesWithLinks.length;
  const linkCount = content.links.length;

  const readme = `${generatedBanner('CONTRIBUTING.md')}

# awesome-expat

[![Awesome](https://awesome.re/badge.svg)](https://awesome.re)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](./LICENSE)
${badge('CI', 'passing', 'green')}
${badge('Links', 'checked nightly', 'blue')}

> A curated directory of expat resources, organised by country.

**[awesome-expat.com](${SITE})** — browse it by map, country, or job role.

## At a glance

| | |
| --- | ---: |
| Countries with resources | ${countryCount} |
| Resources | ${linkCount} |
| Categories | ${topCategories.length} |
| Job roles | ${roleCount} |

## Browse by country

${(() => {
  const places = countriesWithLinks.filter(([slug]) => !isGlobal(slug));
  const global = countriesWithLinks.find(([slug]) => isGlobal(slug));
  const rows = places.map(([slug, country]) => {
    const count = linksForCountry(content, slug).length;
    return `- **[${country.name}](${SITE}${countryPath(slug)})** — ${count} resource${count === 1 ? '' : 's'}`;
  });
  if (global) {
    const [slug] = global;
    const count = linksForCountry(content, slug).length;
    rows.push(`- **[Global](${SITE}${countryPath(slug)})** — ${count} resources that apply anywhere`);
  }
  return rows.join('\n');
})()}

Every country on the site: ${SITE}${countriesPath()}. Directory of the content files, with link counts:
[docs/index.md](docs/index.md).

Browse all categories: ${SITE}${categoriesPath()}.

| Category | Slug | Resources |
| --- | --- | ---: |
${categoryRows}

## Browse by role

Find resources relevant to your job on the site: ${SITE}${rolesPath()}. Each role page also carries every
untagged link, because a general job board is useful to everyone.

${(() => {
  // Count only links *tagged* with the role, not the untagged ones. A role page
  // also shows every untagged link, so counting the page's total gives all five
  // roles a number between 69 and 73 out of 73 -- technically true, and
  // useless as a comparison. The tagged count is what tells the two apart.
  const rows = [...content.roles.entries()]
    .map(([slug, role]) => {
      const tagged = content.links.filter((l) => l.data.roles.includes(slug)).length;
      if (!roleHasEnoughLinks(content, slug)) {
        return `- **${role.name}** — ${tagged} tagged, page not published yet`;
      }
      return `- **[${role.name}](${SITE}${rolePath(slug)})** — ${tagged} tagged`;
    });
  return rows.join('\n');
})()}

Counts per role, and which role pages are thin enough to be unpublished: [docs/jobs.md](docs/jobs.md). For job
boards and hiring rules rather than role-filtered resources, see ${SITE}${jobsPath()}.

## Contribute

Add a resource in nine steps: [CONTRIBUTING.md → Add a link](CONTRIBUTING.md#add-a-link). If you use an AI
coding agent, have it read [AGENTS.md](AGENTS.md) — the same rules, mapped onto the repo layout.

One YAML file per resource under \`content/links/<country>/<category>/\`. There is no web form, which is
deliberate: a link is content, and content belongs in version control. \`make help\` lists every task.

## License

[MIT](LICENSE)
`;

  // ---- Write everything -------------------------------------------------
  // `EXPORT_DIR` lets `make check` generate into a scratch directory and diff,
  // so verifying never mutates the working tree. Regenerating in place would
  // silently overwrite a hand edit, which is the exact mistake this setup
  // exists to catch.
  const outRoot = process.env.EXPORT_DIR ? join(ROOT, process.env.EXPORT_DIR) : ROOT;

  await mkdir(join(outRoot, 'docs', 'countries'), { recursive: true });
  await writeFile(join(outRoot, 'docs', 'index.md'), indexDoc, 'utf8');
  await writeFile(join(outRoot, 'docs', 'jobs.md'), jobsDoc, 'utf8');
  for (let i = 0; i < countryDocs.length; i += 1) {
    const [slug] = countriesWithLinks[i]!;
    await writeFile(join(outRoot, 'docs', 'countries', `${slug}.md`), countryDocs[i]!, 'utf8');
  }
  await writeFile(join(outRoot, 'README.md'), readme, 'utf8');

  console.log(
    `export: README.md, docs/index.md, docs/jobs.md, ${countryDocs.length} country docs ` +
      `(${linkCount} links across ${countryCount} countries)` +
      (process.env.EXPORT_DIR ? ` -> ${process.env.EXPORT_DIR}` : ''),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
