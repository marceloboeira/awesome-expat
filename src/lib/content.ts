import { getCollection } from 'astro:content';
import type { Author, Category, Country, Group, Link, Role } from '@engine/schema.ts';
import type { LoadedLink } from './corpus.ts';

/**
 * Typed access to the content collections.
 *
 * The registry YAML files cannot carry a `slug` field -- every registry schema
 * is `.strict()`, and adding the field to the schema would mean a second
 * identifier that could disagree with the filename. So the slug is derived from
 * the loader's `id`, which for a glob loader is the file path relative to the
 * collection's `base` with the extension stripped. That reproduces exactly
 * what `slugOf()` does in `engine/lib/content.ts`, so the site and the CLI
 * agree on the URL for a given entry.
 *
 * Every loader here hands back `data & { slug }`, which is what lets pages write
 * `category.slug` instead of threading entry ids through the view layer.
 */

export const slugFromId = (id: string): string => {
  const name = id.split('/').pop() ?? id;
  return name.replace(/\.ya?ml$/, '');
};

type Slugged<T> = T & { slug: string };

export async function getCountries(): Promise<Array<Slugged<Country>>> {
  const entries = await getCollection('countries');
  return entries.map((e) => ({ ...e.data, slug: slugFromId(e.id) }));
}

export async function getCategories(): Promise<Array<Slugged<Category>>> {
  const entries = await getCollection('categories');
  return entries.map((e) => ({ ...e.data, slug: slugFromId(e.id) }));
}

export async function getGroups(): Promise<Array<Slugged<Group>>> {
  const entries = await getCollection('groups');
  return entries.map((e) => ({ ...e.data, slug: slugFromId(e.id) }));
}

export async function getRoles(): Promise<Array<Slugged<Role>>> {
  const entries = await getCollection('roles');
  return entries.map((e) => ({ ...e.data, slug: slugFromId(e.id) }));
}

export async function getAuthors(): Promise<Array<Slugged<Author>>> {
  const entries = await getCollection('authors');
  return entries.map((e) => ({ ...e.data, slug: slugFromId(e.id) }));
}

/** Links keep `id` and `data` separate, matching how the pool stores them. */
export async function getLinks(): Promise<LoadedLink[]> {
  const entries = await getCollection('links');
  return entries.map((e) => ({ id: e.id, data: e.data as Link }));
}

/** `code -> name`, for labelling links that point at a country. */
export async function getCountryNames(): Promise<Record<string, string>> {
  const countries = await getCountries();
  return Object.fromEntries(countries.map((c) => [c.slug, c.name]));
}
