import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import {
  countrySchema,
  categorySchema,
  groupSchema,
  roleSchema,
  authorSchema,
  linkSchema,
  postSchema,
} from '@engine/schema.ts';

/**
 * Astro content collections bound to the engine's Zod schemas.
 *
 * This is the payoff of keeping the validation in `engine/lib/schema.ts` and
 * out of a second, site-local copy: the schema that gates CI and the schema
 * that gates a page render are literally the same object. A field added to
 * `linkSchema` is immediately available to `entry.data` with the same
 * constraints, and it is impossible for the two definitions to drift.
 *
 * `id` is supplied by the loader from the file path, which is why `linkSchema`
 * does not contain an `id` key of its own — the path is the identity, so a
 * second one in the body could only ever disagree with it.
 */

export const collections = {
  countries: defineCollection({
    loader: glob({ pattern: '**/*.yaml', base: './content/countries' }),
    schema: countrySchema,
  }),
  categories: defineCollection({
    loader: glob({ pattern: '**/*.yaml', base: './content/categories' }),
    schema: categorySchema,
  }),
  groups: defineCollection({
    loader: glob({ pattern: '**/*.yaml', base: './content/groups' }),
    schema: groupSchema,
  }),
  roles: defineCollection({
    loader: glob({ pattern: '**/*.yaml', base: './content/roles' }),
    schema: roleSchema,
  }),
  authors: defineCollection({
    loader: glob({ pattern: '**/*.yaml', base: './content/authors' }),
    schema: authorSchema,
  }),

  /**
   * Links are the corpus. `id` is the path below `content/links`, with the
   * `.yaml` stripped, so it is stable across a move of the file and matches
   * the `id` the engine writes into generated docs.
   */
  links: defineCollection({
    loader: glob({ pattern: '**/*.yaml', base: './content/links' }),
    schema: linkSchema,
  }),

  posts: defineCollection({
    loader: glob({ pattern: '**/*.yaml', base: './content/posts' }),
    schema: postSchema,
  }),
};
