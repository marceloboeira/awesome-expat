import { SITE, REPO, githubProfile } from './routes.ts';

/**
 * JSON-LD builders. The site emits three kinds of graph:
 *
 * - an Organization on every page (identity: who owns this site, answering
 *   brand queries for Google and for LLMs), plus a WebSite on the home page;
 * - CollectionPage + ItemList on pages that list resources, mirroring what
 *   the reader actually sees, so a cited item points at the resource itself;
 * - ProfilePage for contributors, whose `sameAs` is their GitHub profile.
 *
 * Anything rendered here must describe the page as built: a lastCheckedDate
 * or item list that disagrees with the visible page is worse than nothing.
 */

const siteName = 'Awesome Expat';
const language = 'en';

export const organizationLd = {
  '@type': 'Organization',
  '@id': `${SITE}/#organization`,
  name: siteName,
  url: SITE,
  logo: { '@type': 'ImageObject', url: `${SITE}/og-default.png`, width: 1200, height: 630 },
  sameAs: [REPO],
  knowsAbout: [
    'moving abroad',
    'expat resources',
    'visas and residency',
    'housing',
    'jobs and work',
    'taxes',
    'healthcare',
    'finances and banking',
  ],
};

export const webSiteLd = {
  '@type': 'WebSite',
  '@id': `${SITE}/#website`,
  url: SITE,
  name: siteName,
  inLanguage: language,
  publisher: { '@id': `${SITE}/#organization` },
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${SITE}/search/?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
};

export function siteGraph(isHome: boolean): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': isHome ? [organizationLd, webSiteLd] : [organizationLd],
  };
}

/** A page whose subject is a set of things: countries, categories, roles. */
export function collectionPageLd(opts: {
  title: string;
  description: string;
  path: string;
  items: { name: string; url: string }[];
  dateModified?: string;
}): Record<string, unknown> {
  const url = new URL(opts.path, SITE).toString();
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'CollectionPage',
      '@id': url,
      url,
      name: opts.title,
      description: opts.description,
      inLanguage: language,
      isPartOf: { '@id': `${SITE}/#website` },
      publisher: { '@id': `${SITE}/#organization` },
      ...(opts.dateModified ? { dateModified: `${opts.dateModified}T00:00:00.000Z` } : {}),
      mainEntity: { '@id': `${url}#items` },
    },
    {
      '@type': 'ItemList',
      '@id': `${url}#items`,
      numberOfItems: opts.items.length,
      itemListElement: opts.items.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: item.name,
        url: item.url,
      })),
    },
  ];
  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}

/**
 * The corpus itself as a citable Dataset. Generated artifacts (corpus.json,
 * llms-full.txt) are written by the build from `content/`; these URLs always
 * exist, so pointing at them here cannot rot.
 */
export function datasetLd(opts: {
  totalLinks: number;
  totalCountries: number;
  totalCategories: number;
  dateModified: string;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Dataset',
        '@id': `${SITE}/#dataset`,
        name: 'Awesome Expat resource directory',
        description: `A curated directory of ${opts.totalLinks} practical resources for people moving abroad across ${opts.totalCountries} countries and ${opts.totalCategories} categories. Each entry has a human-written description and a verified URL.`,
        url: SITE,
        inLanguage: language,
        license: 'https://creativecommons.org/publicdomain/zero/1.0/',
        keywords: [
          'expat',
          'moving abroad',
          'visa',
          'housing',
          'jobs',
          'taxes',
          'healthcare',
          'finances',
        ],
        sameAs: REPO,
        creator: { '@id': `${SITE}/#organization` },
        publisher: { '@id': `${SITE}/#organization` },
        dateModified: opts.dateModified ? `${opts.dateModified}T00:00:00.000Z` : undefined,
        distribution: [
          {
            '@type': 'DataDownload',
            encodingFormat: 'application/json',
            url: `${SITE}/corpus.json`,
          },
          {
            '@type': 'DataDownload',
            encodingFormat: 'text/plain',
            url: `${SITE}/llms-full.txt`,
          },
          {
            '@type': 'DataDownload',
            encodingFormat: 'text/markdown',
            url: `${SITE}/llms.txt`,
          },
        ],
      },
    ],
  };
}

export function aboutPageLd(): Record<string, unknown> {
  const url = new URL('/about/', SITE).toString();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'AboutPage',
        '@id': url,
        url,
        name: `About ${siteName}`,
        inLanguage: language,
        publisher: { '@id': `${SITE}/#organization` },
        isPartOf: { '@id': `${SITE}/#website` },
      },
    ],
  };
}

export function profilePageLd(handle: string): Record<string, unknown> {
  const url = new URL(`/contributors/${handle}/`, SITE).toString();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfilePage',
        '@id': url,
        url,
        inLanguage: language,
        isPartOf: { '@id': `${SITE}/#website` },
        mainEntity: {
          '@type': 'Person',
          '@id': `${url}#person`,
          name: handle,
          url,
          sameAs: githubProfile(handle),
        },
      },
    ],
  };
}