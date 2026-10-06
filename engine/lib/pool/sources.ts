/**
 * Where the harvester is allowed to look.
 *
 * Explicit allow-list, no wildcards, and a required `note` explaining why each
 * source is fair to use. The harvester never discovers new hosts on its own;
 * adding a source here is a deliberate, reviewable act.
 *
 * SOURCE SELECTION IS THE MOST IMPORTANT DECISION IN THE POOL.
 *
 * The first version of this list led with `gov.uk/browse/abroad`. That is a
 * *section index*, and harvesting it produced the site's own navigation one hop
 * down: "Help", "Get involved", "Passports", "Travel abroad". The classifier
 * then labelled them with 1.00 confidence, because "Passports" fits `visa`
 * perfectly. Confidence measures category fit, not whether a page is a
 * resource, so a perfectly working pipeline confidently produced a directory
 * of section headings.
 *
 * A source must therefore be a *curated collection of resources*, not a
 * navigation page. The rule of thumb: if a human would bookmark the source
 * page itself, it is a good seed. If a human would use it to find other
 * sections, it is not.
 */
export interface Source {
  slug: string;
  urls: string[];
  note: string;
  /** max pages to pull from this source in one run */
  maxPages: number;
  /** true when the source is a list of links rather than a prose page */
  curated?: boolean;
}

export const SOURCES: Source[] = [
  {
    slug: 'eu-your-europe',
    urls: [
      'https://europa.eu/youreurope/citizens/taxes/index_en.htm',
      'https://europa.eu/youreurope/citizens/employment/index_en.htm',
      'https://europa.eu/youreurope/citizens/healthcare/index_en.htm',
      'https://europa.eu/youreurope/citizens/housing/index_en.htm',
      'https://europa.eu/youreurope/citizens/moving-abroad/index_en.htm',
    ],
    note: 'Official EU guidance for citizens. Prose pages that link to specific sub-guides, not a nav index.',
    maxPages: 5,
  },
  {
    slug: 'remote-jobs-lists',
    urls: [],
    note:
      'Empty on purpose. Several plausible remote-jobs repos were checked and 404 (the remote-jobs/remote-jobs.github.io ' +
      'repo does not exist). Sources here must be verified to return 200; nothing gets added on a guess.',
    maxPages: 0,
    curated: true,
  },
  {
    slug: 'digital-nomad-guides',
    urls: [
      'https://raw.githubusercontent.com/cbovis/awesome-digital-nomads/master/README.md',
      'https://raw.githubusercontent.com/brandonhimpfen/awesome-digital-nomads/main/README.md',
    ],
    note:
      'Curated digital-nomad lists (1k+ stars on the first). Closest existing analogue to this site. ' +
      'URLs verified to return 200; earlier guesses at other repos were 404 and were removed.',
    maxPages: 2,
    curated: true,
  },
  {
    slug: 'country-nomad-list',
    urls: ['https://raw.githubusercontent.com/icyrockcom/country-list/master/README.md'],
    note: 'Per-country cost-of-living breakdowns. The country index this site already links to.',
    maxPages: 1,
    curated: true,
  },
];

export const sourceBySlug = (slug: string): Source | undefined => SOURCES.find((s) => s.slug === slug);
