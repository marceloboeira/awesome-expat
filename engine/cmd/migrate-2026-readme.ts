/**
 * One-shot migration of the hand-written README into `content/links/**`.
 *
 * Dated and kept in the repo on purpose: it records the editorial decisions
 * made during the migration (which links died, which five became one, which
 * redirects are real moves and which are geo-consent artefacts). The original
 * README is in git history at `HEAD~` if any of this needs re-checking.
 *
 *   pnpm dlx tsx engine/cmd/migrate-2026-readme.ts
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { writeYaml } from '../lib/write.ts';
import { slugifyTitle, normaliseUrl } from '../lib/url.ts';
import { countryName } from '../lib/iso.ts';
import { loadContent } from '../lib/content.ts';

const run = promisify(execFile);
const REPO = 'https://github.com/marceloboeira/awesome-expat';
const CHECKED = '2026-09-29';

type Seed = {
  title: string;
  url: string;
  country: string;
  category: string;
  description: string;
  scopes?: string[];
  roles?: string[];
  tags?: string[];
  featured?: boolean;
  /** Set when the description is ours, not copied from the README. */
  authored?: boolean;
};

/** Roles every job-marketplace entry should surface on. */
const ALL_ROLES = ['software-engineer', 'data-scientist', 'product-designer', 'product-manager', 'devops-sre'];

// ---------------------------------------------------------------------------
// The dataset. 68 entries: 73 unique URLs in the old README, minus 4 dead,
// minus 1 nested "Source" link that belongs in a description, and with the
// five Actero copies collapsed into one multi-country entry.
// ---------------------------------------------------------------------------

const LINKS: Seed[] = [
  // --- Destination / cost of living ---------------------------------------
  { title: 'Expatistan', url: 'https://expatistan.com/cost-of-living', country: 'global', category: 'finances',
    description: 'Cost-of-living comparisons for hundreds of cities, built from expat-submitted data.', tags: ['cost-of-living'] },
  { title: 'Numbeo', url: 'https://www.numbeo.com/cost-of-living/', country: 'global', category: 'finances',
    description: 'Crowdsourced cost-of-living data for cities worldwide, covering rent, food, transport and crime.', tags: ['cost-of-living'] },
  { title: 'Teleport', url: 'https://teleport.org', country: 'global', category: 'finances',
    description: 'Compare cities on quality of life, prices and job opportunities to find a good place to land.', tags: ['cost-of-living'] },
  { title: 'ReloMap', url: 'https://relomap.app', country: 'global', category: 'finances',
    description: 'Cost-of-living comparisons for 208 cities, with a tax calculator and visa guides.', tags: ['cost-of-living'] },
  { title: 'Cheaper Abroad', url: 'https://cheaper-abroad.com/en/', country: 'global', category: 'finances',
    description: 'Dated prices for clinics and shops in Da Nang, Bangkok and Budapest, compared against home-country prices.', tags: ['cost-of-living'] },
  { title: 'Coworking Price Index', url: 'https://coworkingview.com/en/tools/price-index', country: 'global', category: 'housing',
    description: 'Median monthly prices for flex desks, fixed desks and private offices across German, Spanish, UK, Dutch and UAE cities.', tags: ['coworking'] },

  // --- Visa and relocation planning --------------------------------------
  { title: 'Visa Income Calculator', url: 'https://expatcove.com/visa-income-calculator/', country: 'global', category: 'visa',
    description: 'See which 2026 residence and digital-nomad visas you qualify for by income, with an affordability index.', tags: ['digital-nomad'] },
  { title: 'Transita', url: 'https://transita.app', country: 'global', category: 'visa',
    description: 'Visa-pathway matcher that ranks residence and work visa options across 10 countries with costs and processing times.', tags: ['digital-nomad'] },
  { title: 'Take Root Abroad', url: 'https://takerootabroad.com', country: 'global', category: 'visa',
    description: 'Move-abroad planner for US citizens: country-fit quiz, visa routes for remote workers and retirees, and the US tax picture.', tags: ['digital-nomad'] },
  { title: 'Daybound', url: 'https://daybound.9ek.ru/', country: 'global', category: 'visa',
    description: 'Schengen 90/180 calculator and per-country stay-day tracker for managing visa-free day limits while abroad.', tags: ['schengen'] },

  // --- Job boards ---------------------------------------------------------
  { title: 'Wellfound (AngelList Talent)', url: 'https://wellfound.com/jobs', country: 'global', category: 'jobs',
    description: "The world's best startups are hiring.", roles: ALL_ROLES, tags: ['remote'] },
  { title: 'HN Hiring', url: 'https://hnhiring.me', country: 'global', category: 'jobs',
    description: 'Monthly-updated software jobs aggregated from Who Is Hiring threads.', roles: ALL_ROLES },
  { title: 'Landing.jobs', url: 'https://landing.jobs', country: 'global', category: 'jobs',
    description: "Europe's best tech jobs marketplace, with relocation support.", roles: ALL_ROLES, tags: ['relocation'] },
  { title: 'Who Is Hiring', url: 'https://whoishiring.io', country: 'global', category: 'jobs',
    description: 'Map of jobs posted to Who Is Hiring threads, for engineers, developers and designers.', roles: ALL_ROLES },
  { title: 'Startup List', url: 'https://startups-list.com/cities', country: 'global', category: 'jobs',
    description: 'Startup jobs around the world, with city-level listings.', roles: ALL_ROLES },
  { title: 'Glassdoor', url: 'https://glassdoor.com/index.htm', country: 'global', category: 'finances',
    description: 'Compare compensation between companies and positions.', tags: ['compensation'] },
  { title: 'Berlin Startup Jobs', url: 'https://berlinstartupjobs.com', country: 'de', category: 'jobs',
    description: 'Startup jobs in Berlin, with visa and relocation details for each listing.', roles: ALL_ROLES, tags: ['germany'] },
  { title: 'List of job boards for Berlin', url: 'https://allaboutberlin.com/guides/find-a-job-in-berlin', country: 'de', category: 'jobs',
    description: 'A curated round-up of the job boards and recruiters actually hiring in Berlin.', roles: ALL_ROLES, tags: ['germany'] },
  { title: 'London Startup Jobs', url: 'https://londonstartupjobs.co.uk', country: 'gb', category: 'jobs',
    description: 'Startup jobs in London, with visa and relocation details for each listing.', roles: ALL_ROLES, tags: ['uk'] },
  { title: 'Jobs in Malta', url: 'https://jobsinmalta.com', country: 'mt', category: 'jobs',
    description: 'Job board for Malta, covering English-speaking and technical roles.', roles: ALL_ROLES, tags: ['malta'] },
  { title: 'Seoulstart Jobs', url: 'https://seoulstart.com/jobs', country: 'kr', category: 'jobs',
    description: 'Jobs in Korea hiring foreign residents, filterable by English, Korean or bilingual posting language.', roles: ALL_ROLES, tags: ['korea'] },

  // --- Temporary accommodation -------------------------------------------
  { title: 'SpotAHome', url: 'https://spotahome.com', country: 'global', category: 'housing',
    description: 'Long-term rental platform offering monthly and longer stays, popular with expats.' },
  { title: 'Couchsurfing', url: 'https://couchsurfing.com', country: 'global', category: 'housing',
    description: 'Free stays with locals, and a useful way to meet people in a new city.' },
  { title: 'Airbnb', url: 'https://airbnb.com', country: 'global', category: 'housing',
    description: 'Rent unique accommodations from local hosts in 191+ countries.', tags: ['short-term'] },
  { title: 'StayingAPI', url: 'https://stayingapi.com', country: 'global', category: 'housing',
    description: 'API for accommodation data across Airbnb, Booking.com, Vrbo and Google Hotels.', tags: ['api'] },
  { title: 'yumpara', url: 'https://yumpara.com', country: 'global', category: 'housing',
    description: 'Rooms and studios rented direct from hosts with no agency or commission, from one month upwards.', tags: ['no-commission'] },

  // --- Flights ------------------------------------------------------------
  { title: 'Skyscanner', url: 'https://www.skyscanner.net', country: 'global', category: 'moving',
    description: 'Compare cheap flights, hotels and car hire across providers.' },
  { title: 'Google Flights', url: 'https://www.google.com/flights/', country: 'global', category: 'moving',
    description: 'Find cheap flights fast, explore destinations on a map, and set fare alerts.' },
  { title: 'Kiwi.com', url: 'https://www.kiwi.com/en/', country: 'global', category: 'moving',
    description: 'Cheap flights, trains, hotels and car hire, with 24/7 support.' },

  // --- Germany ------------------------------------------------------------
  { title: 'How to start a business in Germany', url: 'https://allaboutberlin.com/guides/start-a-business-in-germany', country: 'de', category: 'taxes',
    description: 'Registering a sole trader, getting a tax number, and the VAT and insurance you must carry as a freelancer.', tags: ['germany', 'freelance'], authored: true },
  { title: 'An introduction to German health insurance', url: 'https://allaboutberlin.com/guides/german-health-insurance', country: 'de', category: 'healthcare',
    description: 'How German health insurance works: statutory versus private, what it covers, and what it costs.', tags: ['germany'] },
  { title: 'German banks that do not require an Anmeldung', url: 'https://allaboutberlin.com/guides/best-bank-germany', country: 'de', category: 'finances',
    description: 'Which German banks will open an account before you have a registered address, and what each one requires.', tags: ['germany', 'banking'], authored: true },
  { title: 'Choosing health insurance in Germany', url: 'https://www.settle-in-berlin.com/health-insurance-germany/', country: 'de', category: 'healthcare',
    description: 'A practical walkthrough of picking between statutory and private health insurance in Germany.', tags: ['germany'] },
  { title: 'Actero', url: 'https://actero.ro', country: 'de', category: 'visa',
    description: 'Romanian-language guide for Romanians abroad handling paperwork at a Romanian consulate: passports, national ID, powers of attorney, and transcriptions.',
    scopes: ['de', 'it', 'fr', 'es', 'gb'], tags: ['romanian'], featured: true,
    // One file for what the README listed five times; the five copies had
    // drifted into five near-identical descriptions.
    authored: true },
  { title: 'Settle in Berlin', url: 'https://www.settle-in-berlin.com', country: 'de', category: 'community',
    description: 'Guides on Anmeldung, bank accounts and finding a flat in Berlin, written by someone who has done it.', tags: ['germany', 'berlin'], featured: true },
  { title: 'All About Berlin', url: 'https://allaboutberlin.com', country: 'de', category: 'community',
    description: 'The most complete English-language guide to living in Berlin: registration, housing, jobs, banking and visas.', tags: ['germany', 'berlin'], featured: true },
  { title: 'Moving to Berlin: the definitive guide', url: 'https://allaboutberlin.com/guides/moving-to-berlin', country: 'de', category: 'moving',
    description: 'End-to-end checklist for relocating to Berlin, from paperwork to actually arriving.', tags: ['germany', 'berlin'] },
  { title: 'ExpatWiki: Germany', url: 'https://expatwiki.org/Germany', country: 'de', category: 'housing',
    description: 'Practical low-budget living advice for Germany: housing, transport and how to live for less.',
    tags: ['germany', 'budget'], authored: true, featured: true },

  // --- Italy, Nordics, Spain, UK, China, Korea ---------------------------
  { title: 'TaxCompass', url: 'https://taxcompass.it', country: 'it', category: 'taxes',
    description: 'AI tax assistant for foreigners opening a business in Italy: forfettario regime, partita IVA, INPS and ATECO codes.', tags: ['italy', 'freelance'] },
  { title: 'NordicExpat', url: 'https://nordicexpat.com', country: 'dk', category: 'housing',
    description: 'Relocation guides for non-EU expats moving to Denmark, Sweden, Norway or Finland, covering banking, housing, taxes and healthcare.',
    scopes: ['dk', 'se', 'no', 'fi'], tags: ['nordics'], featured: true },
  { title: 'Nordic take-home pay calculator', url: 'https://nordicexpat.com/tools', country: 'dk', category: 'finances',
    description: 'Gross-to-net salary calculators for Denmark, Sweden, Norway and Finland, including holiday pay and gross-up.',
    scopes: ['dk', 'se', 'no', 'fi'], tags: ['nordics', 'salary'] },
  { title: 'ES Extranjería', url: 'https://esextranjeria.es/en/', country: 'es', category: 'visa',
    description: 'English guides to Spanish visas and residence permits — digital nomad, non-lucrative, student, Beckham law — written against the BOE.', tags: ['spain', 'spanish'] },
  { title: 'Keep your giffgaff number', url: 'https://getgiffgaff.com/tools/keep-number-reminder/', country: 'gb', category: 'moving',
    description: 'Browser-only tool that turns your last giffgaff activity into a reminder before your number is reclaimed, and exports an ICS file.', tags: ['uk', 'telecom'] },
  { title: 'YouChina: Alipay and WeChat Pay', url: 'https://www.you-china.com/en/alipay-for-foreigners', country: 'cn', category: 'finances',
    description: 'English setup guides for Alipay and WeChat Pay using foreign cards, and what to do when a shop only takes mainland wallets.', tags: ['china', 'payments'] },
  { title: 'Awesome Living in Korea', url: 'https://github.com/seoulstart/awesome-living-in-korea', country: 'kr', category: 'community',
    description: 'Curated resources for foreign residents in Korea: visas, ARC registration, jeonse and wolse housing, NHIS, banking and taxes.',
    tags: ['korea'], featured: true },

  // --- Interviewing -------------------------------------------------------
  { title: 'Awesome Interview Questions', url: 'https://github.com/DopplerHQ/awesome-interview-questions', country: 'global', category: 'interviewing',
    description: 'A curated list of lists of interview questions, across algorithms, system design and behavioural rounds.',
    roles: ['software-engineer', 'data-scientist', 'devops-sre'] },
  { title: 'HackerRank', url: 'https://www.hackerrank.com', country: 'global', category: 'interviewing',
    description: 'Practise coding, compete and get hired, with company-specific preparation tracks.',
    roles: ['software-engineer', 'data-scientist'] },
  { title: 'Interview', url: 'https://github.com/Olshansk/interview', country: 'global', category: 'interviewing',
    description: 'Everything you need to prepare for a coding interview: algorithms, questions and study guides.',
    roles: ['software-engineer', 'devops-sre'] },
  { title: 'interviewing.io', url: 'https://interviewing.io', country: 'global', category: 'interviewing',
    description: 'Practice interviewing anonymously with engineers from top companies, and find your weak spots.',
    roles: ['software-engineer', 'data-scientist', 'devops-sre'] },

  // --- Education ----------------------------------------------------------
  { title: 'OSSU Computer Science', url: 'https://ossu.firebaseapp.com/', country: 'global', category: 'education',
    description: 'A complete, free, self-directed path to a computer science degree-equivalent, using open courses.', tags: ['free'] },
  { title: 'OSSU Data Science', url: 'https://github.com/ossu/data-science', country: 'global', category: 'education',
    description: 'A free, self-directed path to data science: statistics, programming, machine learning and SQL.', tags: ['free'] },
  { title: 'Duolingo', url: 'https://www.duolingo.com', country: 'global', category: 'education',
    description: 'The most widely used way to learn a language, and the one most expats already have installed.', tags: ['language', 'free'] },
  { title: 'Memrise', url: 'https://www.memrise.com', country: 'global', category: 'education',
    description: 'Spaced-repetition language learning built around native-speaker video and pronunciation.', tags: ['language'] },
  { title: 'Babbel', url: 'https://babbel.com', country: 'global', category: 'education',
    description: 'Subscription language courses built by teachers, closer to a real course than a gamified app.', tags: ['language'] },

  // --- Finances -----------------------------------------------------------
  { title: 'Equity Compensation Guide', url: 'https://github.com/jlevy/og-equity-compensation', country: 'global', category: 'finances',
    description: 'A plain-English guide to stock options and RSUs: vesting, exercise, taxes and what to negotiate.',
    tags: ['equity', 'us'] },
  { title: 'Wise', url: 'https://wise.com', country: 'global', category: 'finances',
    description: 'Move money between countries at low cost with transparent mid-market exchange rates.', tags: ['banking', 'free'] },
  { title: 'Xoom', url: 'https://www.xoom.com', country: 'global', category: 'finances',
    description: 'Send money, reload phones and pay bills internationally.', tags: ['banking'] },
  { title: 'German salary calculator', url: 'https://lohntastik.de/gns/gross-net-salary-calculator', country: 'de', category: 'finances',
    description: 'Work out how much of a German gross salary survives tax and social contributions.', tags: ['germany', 'salary'] },
  { title: 'FEIE vs Foreign Tax Credit calculator', url: 'https://expatcove.com/feie-vs-foreign-tax-credit-calculator/', country: 'us', category: 'finances',
    description: 'Compares the Foreign Earned Income Exclusion against the Foreign Tax Credit on current IRS brackets, for US citizens abroad.', tags: ['us', 'tax'] },
  { title: 'Paycheck calculator', url: 'https://nutilz.com/paycheck-calculator', country: 'us', category: 'finances',
    description: 'Take-home pay estimate after federal, state and FICA withholding, for anyone working in the US.', tags: ['us', 'salary'] },
  { title: 'Maintaining Florida domicile as a US expat', url: 'https://yourtaxbase.com/expat-tax-guide', country: 'us', category: 'finances',
    description: 'How US citizens abroad can eliminate state income tax by keeping domicile in a no-tax state.', tags: ['us', 'tax'] },
  { title: 'Banking Access Index', url: 'https://www.globalsolo.global/data/banking-access-index', country: 'global', category: 'finances',
    description: 'Open dataset of which US banks accept non-US-resident account holders, with CSV and JSON downloads.', tags: ['banking', 'freelance'] },
  { title: 'Coast FIRE calculator', url: 'https://indepai.app/tools/coast-fire-calculator', country: 'global', category: 'finances',
    description: 'Works out the age you can stop saving and coast to retirement, for expats juggling multiple currencies.', tags: ['retirement'] },
  { title: 'Paperpack', url: 'https://paperpack-7v7.pages.dev/', country: 'au', category: 'finances',
    description: 'Working-holiday tax calculator for Australia, covering ATO rates, treaty comparisons and departing superannuation. Runs in the browser in 8 languages.', tags: ['australia', 'tax'], authored: true },

  // --- Community ----------------------------------------------------------
  { title: 'Awesome Digital Nomads', url: 'https://github.com/cloudfloo/awesome-digital-nomads', country: 'global', category: 'community',
    description: 'A link-checked list of tools for digital nomads: finance, visas, insurance, eSIMs, accommodation and communities.', tags: ['digital-nomad'] },
  { title: 'SeeYourFolks', url: 'https://seeyourfolks.com', country: 'global', category: 'community',
    description: 'Keep track of the people you said you would call, so distance does not quietly become drift.' },
  { title: 'IDPhotoSnap', url: 'https://idphotosnap.com', country: 'global', category: 'moving',
    description: 'Browser-only passport, visa and residence-permit photo tool covering 248 document formats. No upload, no signup, no watermark.', tags: ['documents', 'free'] },
];

/** Authors recoverable from git history with confidence. */
const AUTHORS = [
  { handle: 'marcelo', name: 'Marcelo Boeira', github: 'marceloboeira', bio: 'Maintainer of awesome-expat.' },
  { handle: 'erich-mueller', name: 'E. M.', github: 'erich-mueller' },
  { handle: 'bechbit', name: 'bechbit', github: 'bechbit' },
  { handle: 'hwajongpark', name: 'hwajongpark', github: 'hwajongpark' },
  { handle: 'luisdues', name: 'luisdues', github: 'luisdues' },
  { handle: 'superdan77', name: 'superdan77', github: 'superdan77' },
  { handle: 'the-wizzart', name: 'The-Wizzart', github: 'The-Wizzart' },
];

// ---------------------------------------------------------------------------

/** When this URL first appeared in README.md, from git. */
async function addedAt(url: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['log', '--format=%as', '-S', url, '--', 'README.md']);
    const dates = stdout.trim().split('\n').filter(Boolean).sort();
    return dates[0] ?? CHECKED;
  } catch {
    return CHECKED;
  }
}

async function main() {
  const content = await loadContent();
  if (!content.countries.has('global')) {
    throw new Error('the `global` pseudo-country is missing — create content/countries/global.yaml first');
  }

  for (const author of AUTHORS) {
    await writeYaml(`content/authors/${author.handle}.yaml`, author);
  }

  const slugs = new Map<string, string>();
  let created = 0;
  const problems: string[] = [];

  for (const seed of LINKS) {
    const url = normaliseUrl(seed.url) ?? seed.url;
    const base = slugifyTitle(seed.title);

    let slug = base;
    let suffix = 2;
    while (slugs.has(`${seed.country}/${slug}`)) {
      slug = `${base}-${suffix++}`;
    }
    slugs.set(`${seed.country}/${slug}`, url);

    const path = `content/links/${seed.country}/${seed.category}/${slug}.yaml`;
    const data = {
      title: seed.title,
      url,
      country: seed.country,
      ...(seed.scopes ? { scopes: seed.scopes } : {}),
      category: seed.category,
      roles: seed.roles ?? [],
      description: seed.description,
      contributors: [],
      added_at: await addedAt(seed.url),
      last_checked: CHECKED,
      featured: seed.featured ?? false,
      tags: seed.tags ?? [],
    };

    const created_ = await writeYaml(path, data);
    if (created_) created += 1;
    else problems.push(`exists: ${path}`);
  }

  // Report any URL in the old README that is not in the dataset, so the
  // migration cannot silently drop a link.
  const old = await readFile('.agents/tmp/ORIGINAL_README.md', 'utf8');
  const oldUrls = new Set(
    [...old.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => normaliseUrl(m[2]!) ?? m[2]!),
  );
  const migrated = new Set(LINKS.map((seed) => normaliseUrl(seed.url) ?? seed.url));
  const unmigrated = [...oldUrls].filter((url) => !migrated.has(url));

  console.log(`migrate: ${created} links written, ${AUTHORS.length} authors`);
  console.log(`         ${LINKS.length} entries -> ${slugs.size} files`);
  if (problems.length) console.log(`         skipped: ${problems.join(', ')}`);
  console.log(`\n         ${oldUrls.size} unique URLs in the old README, ${unmigrated.length} intentionally dropped:`);
  for (const url of unmigrated) console.log(`           - ${url}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
