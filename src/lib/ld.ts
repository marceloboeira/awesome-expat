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

export const organizationLd = {
  '@type': 'Organization',
  '@id': `${SITE}/#organization`,
  name: siteName,
  url: SITE,
  logo: { '@type': 'ImageObject', url: `${SITE}/og-default.png` },
  sameAs: [REPO],
};

export const webSiteLd = {
  '@type': 'WebSite',
  '@id': `${SITE}/#website`,
  url: SITE,
  name: siteName,
  publisher: { '@id': `${SITE}/#organization` },
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
}): Record<string, unknown> {
  const url = new URL(opts.path, SITE).toString();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': url,
        url,
        name: opts.title,
        description: opts.description,
        isPartOf: { '@id': `${SITE}/#website` },
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
    ],
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
        sameAs: REPO,
        creator: { '@id': `${SITE}/#organization` },
        dateModified: opts.dateModified,
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
        publisher: { '@id': `${SITE}/#organization` },
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
