import { loadContent, linksForCountry, ROLE_PAGE_THRESHOLD } from '../lib/content.ts';

/** Show what is in the repo, so a new contributor or agent can orient fast. */
async function main() {
  const content = await loadContent();

  console.log('countries   ', content.countries.size);
  console.log('categories  ', content.categories.size);
  console.log('groups      ', content.groups.size);
  console.log('roles       ', content.roles.size);
  console.log('authors     ', content.authors.size);
  console.log('links       ', content.links.length);
  console.log('posts       ', content.posts.filter((p) => !p.data.draft).length);

  const withLinks = [...content.countries.keys()].filter((slug) => linksForCountry(content, slug).length > 0);
  console.log(`\ncountries with resources (${withLinks.length}):`);
  for (const slug of withLinks.sort()) {
    const country = content.countries.get(slug)!;
    const links = linksForCountry(content, slug);
    const categories = new Set(links.map((l) => l.data.category));
    console.log(
      `  ${slug.padEnd(8)} ${country.name.padEnd(20)} ${String(links.length).padStart(3)} links, ${categories.size} categories`,
    );
  }

  const empty = [...content.categories.entries()].filter(
    ([slug]) => !content.links.some((l) => l.data.category === slug),
  );
  if (empty.length) {
    console.log(`\ncategories with no links yet (${empty.length}):`);
    for (const [slug, category] of empty) console.log(`  ${slug.padEnd(20)} ${category.name}`);
  }

  console.log('\nrole pages:');
  for (const [slug, role] of content.roles) {
    const specific = content.links.filter((l) => l.data.roles.includes(slug));
    const total = content.links.filter((l) => l.data.roles.length === 0 || l.data.roles.includes(slug));
    const countries = new Set(specific.map((l) => l.data.country));
    const ok = total.length >= ROLE_PAGE_THRESHOLD;
    console.log(
      `  ${slug.padEnd(20)} ${String(specific.length).padStart(2)} role-specific, ` +
        `${String(total.length).padStart(2)} incl. general, ${countries.size} countries ` +
        `-> ${ok ? 'publish' : `below threshold (${ROLE_PAGE_THRESHOLD})`}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
