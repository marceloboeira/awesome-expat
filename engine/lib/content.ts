import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  authorSchema,
  categorySchema,
  countrySchema,
  groupSchema,
  linkSchema,
  postSchema,
  roleSchema,
  type Author,
  type Category,
  type Country,
  type Group,
  type Link,
  type Post,
} from './schema.ts';
import { normaliseUrl } from './url.ts';

/** Repository root, resolved from this file rather than `process.cwd()`. */
export const ROOT = new URL('../../', import.meta.url).pathname;
export const CONTENT_DIR = join(ROOT, 'content');

/** One file on disk, plus where it came from — needed for good error messages. */
export interface Loaded<T> {
  data: T;
  /** Repo-relative path, e.g. `content/links/de/taxes/elster.yaml`. */
  file: string;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) out.push(full);
  }
  return out.sort();
}

async function readAll<T>(
  dir: string,
  schema: z.ZodType<T>,
  label: string,
  errors: ValidationIssue[],
): Promise<Loaded<T>[]> {
  const files = await walk(dir);
  const out: Loaded<T>[] = [];

  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join('/');
    try {
      const raw = await readFile(file, 'utf8');
      const result = schema.safeParse(parseYaml(raw));

      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            kind: label,
            file: rel,
            message: issue.message,
            path: issue.path.join('.') || '(root)',
          });
        }
        continue;
      }
      out.push({ data: result.data, file: rel });
    } catch (cause) {
      errors.push({
        kind: label,
        file: rel,
        message: cause instanceof Error ? cause.message : String(cause),
        path: '(unparseable)',
      });
    }
  }
  return out;
}

export interface ValidationIssue {
  kind: 'countries' | 'categories' | 'groups' | 'roles' | 'authors' | 'links' | 'posts' | 'cross-reference';
  file: string;
  path: string;
  message: string;
}

export interface Content {
  countries: Map<string, Country>;
  categories: Map<string, Category>;
  groups: Map<string, Group>;
  roles: Map<string, Role>;
  authors: Map<string, Author>;
  links: Loaded<Link>[];
  posts: Loaded<Post>[];
  issues: ValidationIssue[];
}

/**
 * Registry files are `<slug>.yaml` and the slug is the filename.
 *
 * Countries are seeded with `code` and no `slug` field, so for them the map
 * key is the ISO alpha-2 code — which is also the URL segment. Keeping the two
 * identical avoids a second, redundant identifier that could disagree with
 * the first.
 */
const bySlug = <T>(items: Loaded<T>[]) =>
  new Map(items.map((item) => [slugOf(item.file, item.data), item.data]));

function slugOf(file: string, _data: unknown): string {
  // Registry files are named `<slug>.yaml`; the slug is the filename.
  const name = file.split('/').pop() ?? file;
  return name.replace(/\.ya?ml$/, '');
}

/**
 * Load and validate every content file.
 *
 * Schema failures and cross-reference failures are both collected rather than
 * thrown, so `make check` can report all problems in one pass instead of
 * forcing a fix-rerun-fix cycle.
 */
export async function loadContent(): Promise<Content> {
  const issues: ValidationIssue[] = [];

  const [countryFiles, categoryFiles, groupFiles, roleFiles, authorFiles, linkFiles, postFiles] =
    await Promise.all([
      readAll(join(CONTENT_DIR, 'countries'), countrySchema, 'countries', issues),
      readAll(join(CONTENT_DIR, 'categories'), categorySchema, 'categories', issues),
      readAll(join(CONTENT_DIR, 'groups'), groupSchema, 'groups', issues),
      readAll(join(CONTENT_DIR, 'roles'), roleSchema, 'roles', issues),
      readAll(join(CONTENT_DIR, 'authors'), authorSchema, 'authors', issues),
      readAll(join(CONTENT_DIR, 'links'), linkSchema, 'links', issues),
      readAll(join(CONTENT_DIR, 'posts'), postSchema, 'posts', issues),
    ]);

  const countries = bySlug(countryFiles);
  const categories = bySlug(categoryFiles);
  const groups = bySlug(groupFiles);
  const roles = bySlug(roleFiles);
  const authors = bySlug(authorFiles);

  // --- Cross-references ----------------------------------------------------
  const ref = (
    file: string,
    path: string,
    value: string,
    kind: ValidationIssue['kind'],
    registry: Map<string, unknown>,
    registryName: string,
  ) => {
    if (!registry.has(value)) {
      issues.push({ kind, file, path, message: `unknown ${registryName} "${value}"` });
    }
  };

  for (const { data, file } of groupFiles) {
    for (const country of data.countries) ref(file, 'countries', country, 'cross-reference', countries, 'country');
  }

  for (const { data, file } of linkFiles) {
    ref(file, 'country', data.country, 'cross-reference', countries, 'country');
    ref(file, 'category', data.category, 'cross-reference', categories, 'category');

    for (const scope of data.scopes ?? []) ref(file, 'scopes', scope, 'cross-reference', countries, 'country');
    for (const role of data.roles) ref(file, 'roles', role, 'cross-reference', roles, 'role');

    // The file's directory must match its declared primary country, otherwise
    // the generated URL and the folder disagree and the link goes missing.
    // Path shape: content/links/<country>/<category>/<id>.yaml
    const dirCountry = file.split('/')[2];
    if (dirCountry !== data.country) {
      issues.push({
        kind: 'cross-reference',
        file,
        path: 'country',
        message: `declared country "${data.country}" does not match directory "${dirCountry}"`,
      });
    }
  }

  for (const { data, file } of postFiles) {
    ref(file, 'author', data.author, 'cross-reference', authors, 'author');
  }

  // --- Duplicate detection -------------------------------------------------
  const seenUrls = new Map<string, string>();
  for (const { data, file } of linkFiles) {
    const key = normaliseUrl(data.url as unknown as string) ?? (file as string);
    const existing = seenUrls.get(key);
    if (existing) {
      issues.push({
        kind: 'links',
        file,
        path: 'url',
        message: `duplicate of ${existing} (same URL after normalisation)`,
      });
    } else {
      seenUrls.set(key, file);
    }
  }

  return {
    countries,
    categories,
    groups,
    roles,
    authors,
    links: linkFiles,
    posts: postFiles,
    issues,
  };
}

/** Links that apply to a country — includes links scoped to it from elsewhere. */
export function linksForCountry(content: Content, countrySlug: string): Loaded<Link>[] {
  return content.links.filter((entry) => entry.data.country === countrySlug || (entry.data.scopes ?? []).includes(countrySlug));
}

/** Links in a country that are filed *under* it, for the primary-country page. */
export function primaryLinksForCountry(content: Content, countrySlug: string): Loaded<Link>[] {
  return content.links.filter((entry) => entry.data.country === countrySlug);
}

export function linksForCategory(content: Content, countrySlug: string, categorySlug: string): Loaded<Link>[] {
  return linksForCountry(content, countrySlug).filter((entry) => entry.data.category === categorySlug);
}

/** Role-agnostic links plus links explicitly tagged with `roleSlug`. */
export function linksForRole(content: Content, roleSlug: string): Loaded<Link>[] {
  return content.links.filter((entry) => entry.data.roles.length === 0 || entry.data.roles.includes(roleSlug));
}

export function linksForRoleCountry(content: Content, roleSlug: string, countrySlug: string): Loaded<Link>[] {
  return linksForCountry(content, countrySlug).filter(
    (entry) => entry.data.roles.length === 0 || entry.data.roles.includes(roleSlug),
  );
}

/** A role page is only worth generating with a few links behind it. */
export const ROLE_PAGE_THRESHOLD = 3;

export function roleHasEnoughLinks(content: Content, roleSlug: string): boolean {
  return linksForRole(content, roleSlug).length >= ROLE_PAGE_THRESHOLD;
}
