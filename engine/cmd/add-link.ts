import { join } from 'node:path';
import { ROOT, loadContent } from '../lib/content.ts';
import { normaliseUrl } from '../lib/url.ts';
import { writeYaml } from '../lib/write.ts';
import { githubUserSchema } from '../lib/schema.ts';
import { buildLinkRecord, extractTitle, idForTitle, uniqueId } from '../lib/add-link.ts';

/**
 * Scaffold one link file from a URL.
 *
 * This exists to remove the two things that actually stop a contributor: the
 * eleven-field YAML template, and the canonical-URL rules (https, no `www.`,
 * no tracking params, no trailing slash). Both are mechanical, so both belong
 * in a script; `make validate` still has the final say on the result.
 *
 * What it deliberately does NOT do is write the description. The whole value of
 * this site is a sentence somebody wrote after reading the page, and a
 * generated one is worse than no entry at all -- it would be published under a
 * "written by a person" claim. So `--description` is required, unless you
 * explicitly ask for `--draft`, which writes an obvious TODO placeholder and
 * leaves `description_verified: false` so the site labels it as unreviewed.
 *
 * Through make, arguments are NAME=value (make rejects `--name=value` as its
 * own option). Directly, the script takes the `--name=value` form:
 *
 *   make add-link URL=https://example.com COUNTRY=de CATEGORY=housing \
 *     DESCRIPTION="What it is actually good for."
 *
 *   pnpm run add-link -- --url=https://example.com --country=de \
 *     --category=housing --description="..." --roles=software-engineer --tags=free
 *
 * Optional: --title --roles=a,b --scopes=de,at --tags=free,newsletter
 *           --contributor=<github-handle> --featured --id=<slug> --draft
 */

/** `--name=value`, matching the convention add-country uses. */
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const list = (name: string): string[] =>
  (arg(name) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

/**
 * Pull a human-readable title off a page.
 *
 * Failures return null rather than throwing: a site that blocks bots is a
 * normal outcome, and the caller falls back to the hostname and asks for
 * `--title` instead of aborting a contributor's workflow.
 */
async function fetchTitle(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Identify honestly. Some sites serve a degraded page to unknown agents,
        // and a wrong title from that is worse than no title.
        'user-agent': 'awesome-expat-link-checker (+https://awesome-expat.com/contribute/)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) return null;
    if (!(response.headers.get('content-type') ?? '').includes('html')) return null;

    // Cap the read. Only the <head> is needed, and an unbounded read of a large
    // page is a way to hang a CLI on a hostile server.
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: string[] = [];
    let size = 0;
    while (size < 300_000) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value, { stream: true }));
      size += value.byteLength;
    }
    await reader.cancel();

    return extractTitle(chunks.join(''), url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  // `pnpm run add-link --` leaves a bare `--` in argv, which is not a URL.
  const positional = process.argv[2];
  const rawUrl = arg('url') ?? (positional && positional !== '--' ? positional : undefined);
  if (!rawUrl) {
    console.error(
      'usage: make add-link URL=https://example.com COUNTRY=de CATEGORY=housing \\\n' +
        '         DESCRIPTION="What this resource is actually good for."\n',
    );
    console.error('  (make takes NAME=value; call `pnpm run add-link -- --flag=value` for the rest)');
    console.error('  --title        override the title suggested from the page');
    console.error('  --roles=a,b    roles this link is specifically for (default: everyone)');
    console.error('  --scopes=de,at other countries it is useful for');
    console.error('  --tags=a,b     free-form extras, e.g. free, german');
    console.error('  --contributor=<github-handle>');
    console.error('  --featured     show at the top of the country page');
    console.error('  --id=<slug>    override the generated filename');
    console.error('  --draft        allow a TODO placeholder description (unreviewed)');
    process.exit(1);
  }

  const content = await loadContent();

  const country = (arg('country') ?? '').toLowerCase();
  const category = (arg('category') ?? '').toLowerCase();

  if (!country) {
    fail(`--country is required. Registered: ${[...content.countries.keys()].sort().join(' ')}`);
  }
  if (!content.countries.has(country)) {
    fail(
      `"${country}" is not a registered country. Registered: ` +
        `${[...content.countries.keys()].sort().join(' ')}\n` +
        `  add a new one with: make add-country CODE=${country} REGION=<region>`,
    );
  }
  if (!category) {
    fail(`--category is required. Registered: ${[...content.categories.keys()].sort().join(' ')}`);
  }
  if (!content.categories.has(category)) {
    fail(
      `"${category}" is not a registered category. Registered: ` +
        `${[...content.categories.keys()].sort().join(' ')}`,
    );
  }

  const canonical = normaliseUrl(rawUrl);
  if (!canonical) fail(`not a usable URL: ${rawUrl}`);

  // --- Dedup, before anything else ----------------------------------------
  // Two files that normalise to the same URL are the same link, and both would
  // be published competing for the same query.
  for (const { data, file } of content.links) {
    if (normaliseUrl(data.url) === canonical) {
      fail(
        `already in the corpus: ${data.url}\n  ${file}\n` +
          '  Edit that file instead of adding a second copy.',
      );
    }
  }

  // --- Title --------------------------------------------------------------
  let title = arg('title');
  if (!title) {
    console.error(`fetching a title from ${canonical} ...`);
    title = (await fetchTitle(canonical)) ?? undefined;
    if (!title) console.error('  could not read a title from that page (it may block bots)');
  }
  if (!title) {
    const host = new URL(canonical).hostname.replace(/^www\./, '');
    console.error(`  falling back to the hostname "${host}" — pass --title to set it properly`);
    title = host;
  }
  if (title.length < 3 || title.length > 120) {
    fail(`--title must be 3-120 characters (got ${title.length}): ${JSON.stringify(title)}`);
  }

  // --- Description --------------------------------------------------------
  const draft = flag('draft');
  const description = arg('description');
  if (!description) {
    if (!draft) {
      fail(
        '--description is required, and this tool will not write one for you.\n' +
          '  The whole point of this site is a sentence a person wrote after reading\n' +
          '  the page. Pass one with --description="..."\n' +
          '  To write the file first and fill it in afterwards, add --draft.',
      );
    }
    console.error('\n--draft: writing a TODO description. It will be published as unreviewed');
    console.error('until you replace it and set description_verified: true.\n');
  }

  const scopes = list('scopes').map((s) => s.toLowerCase());
  for (const scope of scopes) {
    if (!content.countries.has(scope)) {
      fail(`--scopes contains "${scope}", which is not a registered country`);
    }
  }

  const roles = list('roles').map((r) => r.toLowerCase());
  for (const role of roles) {
    if (!content.roles.has(role)) {
      fail(
        `--roles contains "${role}", which is not a registered role. ` +
          `Registered: ${[...content.roles.keys()].sort().join(' ')}`,
      );
    }
  }

  const contributors = list('contributor').map((handle) => {
    const parsed = githubUserSchema.safeParse(handle);
    if (!parsed.success) fail(`--contributor "${handle}" is not a GitHub username`);
    return parsed.data;
  });

  // --- Filename -----------------------------------------------------------
  const dir = `content/links/${country}/${category}`;
  const id = idForTitle(title, arg('id'));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    fail(`--id must be kebab-case: ${JSON.stringify(id)}`);
  }

  const finalId = await uniqueId(join(ROOT, dir), id);
  if (finalId !== id) console.error(`  ${id}.yaml already exists in ${dir}, using ${finalId}.yaml`);

  const relPath = `${dir}/${finalId}.yaml`;

  // Field order matches the existing files so a diff reads cleanly.
  await writeYaml(
    relPath,
    buildLinkRecord({
      title,
      url: canonical,
      country,
      category,
      description:
        description ??
        'TODO: replace this with a sentence about what this resource is actually good for.',
      addedAt: new Date().toISOString().slice(0, 10),
      scopes,
      roles,
      tags: list('tags'),
      contributors,
      featured: flag('featured'),
      // A supplied description is still only the contributor's claim, so this
      // stays false until they have read the page and said so. It is not this
      // script's place to assert that a human verified it.
      descriptionVerified: false,
    }),
  );

  console.log(`\ncreated ${relPath}`);
  if (canonical !== rawUrl) console.log(`  url canonicalised: ${rawUrl} -> ${canonical}`);

  const after = await loadContent();
  const problems = after.issues.filter((i) => i.file === relPath);
  if (problems.length) {
    console.error('\nthe new file does not validate:');
    for (const issue of problems) console.error(`  ${issue.path}: ${issue.message}`);
    process.exit(1);
  }

  console.log('validates clean\n');
  if (!description) console.log('next: write the description, then set description_verified: true');
  console.log(`next: make validate && make export && make ci, then open a PR (${relPath})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
