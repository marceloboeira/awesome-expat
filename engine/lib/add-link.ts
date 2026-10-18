import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { slugifyTitle } from './url.ts';

/**
 * Pure helpers behind `make add-link`, kept out of the command so they can be
 * tested. The command itself calls `main()` at import time and writes to
 * `content/`, so a test can exercise the decisions but not the file writing.
 *
 * The decisions that matter here are the ones that produce a plausible-looking
 * but wrong link file: a title scraped from the wrong meta tag, and a filename
 * that silently overwrites an existing entry.
 */

/** Longest filename slug the schema allows (slugSchema caps id at 64). */
export const MAX_ID = 64;

/**
 * Strip tags/entities from a scraped title and drop the site name that document
 * titles usually carry ("Find a flat — Example Site" -> "Find a flat").
 *
 * Returns null when nothing usable is left, so the caller can fall back to the
 * hostname rather than writing a 2-character title the schema would reject.
 */
export function cleanTitle(raw: string, pageUrl: string): string | null {
  const title = decodeEntities(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let out = title;

  // Only strip the tail when it looks like the site's own name, and only when
  // enough of a real title survives. "Jobs | Indeed" must not become "".
  const host = hostOf(pageUrl);
  const siteName = host.split('.')[0] ?? '';
  if (host && siteName.length > 3) {
    const escaped = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stripped = out.replace(new RegExp(`\\s*[|\\-–—·:]\\s*${escaped}\\s*$`, 'i'), '').trim();
    if (stripped.length >= 3) out = stripped;
  }

  if (out.length < 3) return null;
  // Truncate to the schema's 120-char ceiling with a real ellipsis, not a
  // mid-word cut that would look like the title ended there on purpose.
  return out.length > 120 ? `${out.slice(0, 117).trimEnd()}...` : out;
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ');

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The candidate filename for a link, without the directory or extension. */
export function idForTitle(title: string, override?: string): string {
  const raw = (override ?? slugifyTitle(title)).replace(/\.ya?ml$/, '').slice(0, MAX_ID);
  // slugifyTitle can leave a trailing dash after truncation; drop it.
  return raw.replace(/-+$/, '');
}

/**
 * Find a filename that is not taken, appending -2, -3, ... on collision.
 *
 * The collision matters more than it looks: two links filed under the same
 * country and category with the same title are common (a country's housing
 * sites often share a name), and overwriting the first would delete a real
 * entry while `make validate` reported a clean tree.
 */
export async function uniqueId(dirAbs: string, id: string): Promise<string> {
  const taken = async (candidate: string) => {
    try {
      await access(join(dirAbs, `${candidate}.yaml`));
      return true;
    } catch {
      return false;
    }
  };

  if (!(await taken(id))) return id;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${id}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new Error(`could not find a free filename for "${id}" in ${dirAbs}`);
}

/**
 * Extract a title from a page's HTML.
 *
 * Order is deliberate: `og:title` is the page's own description of itself and
 * is far more likely to be the resource's name than the document title. Every
 * value returned is text that literally appears on the page -- this function
 * never invents a title, because a plausible invented one is indistinguishable
 * from a real one once it is in the file.
 */
export function extractTitle(html: string, pageUrl: string): string | null {
  const meta = (property: string): string | undefined => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']*)["']`,
      'i',
    );
    return re.exec(html)?.[1];
  };

  const raw =
    meta('og:title') ??
    /<h1[^>]*>([\s\S]{1,200}?)<\/h1>/i.exec(html)?.[1] ??
    /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(html)?.[1];

  return raw === undefined ? null : cleanTitle(raw, pageUrl);
}

/**
 * Assemble the object that becomes the YAML file.
 *
 * This is a function rather than an inline literal because a field can be
 * validated and then silently dropped on the way to the file, and nothing
 * downstream can tell: the file still parses, still passes `linkSchema`, and
 * the contributor believes they set a flag. `roles` was lost exactly this way
 * once already.
 */
export interface LinkRecordInput {
  title: string;
  url: string;
  country: string;
  category: string;
  description: string;
  addedAt: string;
  scopes?: string[];
  roles?: string[];
  tags?: string[];
  contributors?: string[];
  featured?: boolean;
  descriptionVerified?: boolean;
  lastChecked?: string | null;
}

export function buildLinkRecord(input: LinkRecordInput): Record<string, unknown> {
  const scopes = (input.scopes ?? []).filter((s) => s !== input.country);
  return {
    title: input.title,
    url: input.url,
    country: input.country,
    // Omitted entirely when the link applies to one country, which is the
    // common case; `scopes` must include the primary country when present.
    ...(scopes.length ? { scopes: [input.country, ...scopes] } : {}),
    category: input.category,
    roles: input.roles ?? [],
    description: input.description,
    added_at: input.addedAt,
    last_checked: input.lastChecked ?? null,
    description_verified: input.descriptionVerified ?? false,
    featured: input.featured ?? false,
    tags: input.tags ?? [],
    contributors: input.contributors ?? [],
  };
}
