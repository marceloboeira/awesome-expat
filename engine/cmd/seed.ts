import { writeYaml } from '../lib/write.ts';
import { seedCountries } from '../lib/iso.ts';
import type { Category, Group, Role } from '../lib/schema.ts';

/**
 * Slugs are written out rather than derived from `name`. Deriving them means a
 * rename of `name` silently moves the file, which breaks every URL and every
 * link's `category` field. An explicit slug is a one-line edit with a
 * deliberate review of its blast radius.
 *
 * `order` is the order a visitor reads a country page in: from "I have just
 * arrived and need a bed" through to "I might stay permanently".
 */
const CATEGORIES: Array<Category & { slug: string }> = [
  { slug: 'housing', name: 'Housing', description: 'Finding, renting and buying a place to live.', order: 10 },
  { slug: 'jobs', name: 'Jobs & Work', description: 'Finding work, freelancing, and remote opportunities.', order: 20 },
  { slug: 'taxes', name: 'Taxes', description: 'Tax registration, filing deadlines, and government portals.', order: 30 },
  { slug: 'healthcare', name: 'Health & Insurance', description: 'Public healthcare, private insurance, and pharmacies.', order: 40 },
  { slug: 'finances', name: 'Finances & Banking', description: 'Opening bank accounts, transfers, and budgeting.', order: 50 },
  { slug: 'visa', name: 'Visas & Residency', description: 'Applying for visas, residence permits, and renewals.', order: 60 },
  { slug: 'permanent-residency', name: 'Permanent Residency', description: 'Long-term residence, settlement, and naturalisation.', order: 70 },
  { slug: 'citizenship', name: 'Citizenship', description: 'Routes to citizenship and what they require.', order: 80 },
  { slug: 'moving', name: 'Moving', description: 'Shipping belongings, customs, and relocation logistics.', order: 90 },
  { slug: 'interviewing', name: 'Interviewing', description: 'CVs, interviews, and the local hiring process.', order: 100 },
  { slug: 'community', name: 'Community & Groups', description: 'Meetups, expat groups, and forums for a given country.', order: 110 },
  { slug: 'education', name: 'Learning & Language', description: 'Language courses, universities, and integration.', order: 120 },
];

/** Groups are editorial views over countries; each country may appear in several. */
const GROUPS: Array<Group & { slug: string }> = [
  {
    slug: 'europe',
    name: 'Europe',
    description: 'EU and EEA countries, plus the UK and Switzerland.',
    countries: [
      'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'ie', 'it',
      'lv', 'lt', 'lu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se', 'gb', 'ch', 'no', 'is',
    ],
  },
  {
    slug: 'americas',
    name: 'Americas',
    description: 'North, Central, and South America.',
    countries: ['ca', 'mx', 'cr', 'pa', 'gt', 'co', 'br', 'ar', 'cl', 'pe', 'uy', 'do', 'jm'],
  },
  {
    slug: 'asia-pacific',
    name: 'Asia-Pacific',
    description: 'East, South, and Southeast Asia plus Oceania.',
    countries: ['jp', 'kr', 'cn', 'hk', 'tw', 'sg', 'my', 'th', 'vn', 'id', 'ph', 'in', 'au', 'nz'],
  },
];

/** Controlled vocabulary for the `/jobs/:role` axis. */
const ROLES: Array<Role & { slug: string }> = [
  { slug: 'software-engineer', name: 'Software Engineer', description: 'Backend, frontend, full-stack, and mobile engineering roles.' },
  { slug: 'data-scientist', name: 'Data Scientist', description: 'Data science, machine learning, and analytics roles.' },
  { slug: 'product-designer', name: 'Product Designer', description: 'Product, UX, and UI design roles.' },
  { slug: 'product-manager', name: 'Product Manager', description: 'Product management and product ownership roles.' },
  { slug: 'devops-sre', name: 'DevOps / SRE', description: 'Infrastructure, reliability, and platform engineering roles.' },
];

/**
 * Idempotent: existing files are left untouched, so running `make seed` on a
 * repo with hand-edited entries never clobbers work.
 */
async function main() {
  let written = 0;
  let skipped = 0;

  for (const country of seedCountries()) {
    (await writeYaml(`content/countries/${country.code}.yaml`, country, { skipIfExists: true }))
      ? (written += 1)
      : (skipped += 1);
  }
  for (const { slug, ...category } of CATEGORIES) {
    (await writeYaml(`content/categories/${slug}.yaml`, category, { skipIfExists: true }))
      ? (written += 1)
      : (skipped += 1);
  }
  for (const { slug, ...group } of GROUPS) {
    (await writeYaml(`content/groups/${slug}.yaml`, group, { skipIfExists: true }))
      ? (written += 1)
      : (skipped += 1);
  }
  for (const { slug, ...role } of ROLES) {
    (await writeYaml(`content/roles/${slug}.yaml`, role, { skipIfExists: true }))
      ? (written += 1)
      : (skipped += 1);
  }

  console.log(`seed: ${written} written, ${skipped} already present`);
  console.log(`      ${CATEGORIES.length} categories, ${GROUPS.length} groups, ${ROLES.length} roles`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
