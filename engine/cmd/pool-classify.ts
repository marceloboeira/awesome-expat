import { z } from 'zod';
import { ensurePoolDirs, writeJsonAtomic } from '../lib/pool/store.ts';
import { loadAllCandidates, writeStage } from '../lib/pool/pool.ts';
import { generateJson, isServerUp, MODELS } from '../lib/pool/ollama.ts';
import { loadContent } from '../lib/content.ts';
import { join } from 'node:path';
import { POOL_DIRS } from '../lib/pool/store.ts';
import { wordCount } from '../lib/pool/extract.ts';
import type { PoolCandidate } from '../lib/pool/schema.ts';

/**
 * Classify a candidate into the controlled vocabulary.
 *
 * The vocabulary is passed in from the real registries rather than hard-coded
 * in the prompt. If a category is renamed in `content/categories/`, the model
 * sees the new name on the next run instead of inventing a third spelling.
 *
 * `temperature: 0` (set in the Ollama client) makes this reproducible: the same
 * candidate classifies identically on every run, which is what allows the
 * stage to be idempotent.
 *
 * Confidence below the gate is not an error. It becomes `rejected` with
 * `low-confidence`, so a human can see what the model was unsure about instead
 * of it being silently dropped.
 */

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [k, v = 'true'] = arg.replace(/^--/, '').split('=');
  args.set(k!, v);
}
const GATE = Number(args.get('gate') ?? '0.6');
const APPLY = args.get('apply') === 'true';
const LIMIT = Number(args.get('limit') ?? '0');

const classificationSchema = z.object({
  country: z.string(),
  category: z.string(),
  scopes: z.array(z.string()).default([]),
  roles: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().default(''),
});
type Raw = z.infer<typeof classificationSchema>;

const now = () => new Date().toISOString();

function buildPrompt(
  c: PoolCandidate,
  countries: string[],
  categories: string[],
  roles: string[],
): string {
  return [
    'You classify a resource for an expat reference site. Answer with JSON only.',
    '',
    'Pick exactly one country code. Use the ISO 3166-1 alpha-2 code, or "zz" for',
    'a resource that is not tied to one country.',
    'Pick exactly one category. Pick zero or more roles; use [] if the resource',
    'is not role-specific.',
    '',
    `COUNTRIES (${countries.length}): ${countries.join(' ')}`,
    `CATEGORIES: ${categories.join(' ')}`,
    `ROLES: ${roles.join(' ')}`,
    '',
    `Title: ${c.title}`,
    `URL: ${c.url}`,
    `Context: ${c.context.slice(0, 400)}`,
    '',
    'Answer with exactly this shape:',
    '{"country":"..","category":"..","scopes":[],"roles":[],"confidence":0.0,"rationale":".."}',
    'confidence is how certain you are that BOTH country and category are right.',
  ].join('\n');
}

/** Repairs the model picking something outside the closed vocabulary. */
function coerce(raw: Raw, countries: Set<string>, categories: Set<string>, roles: Set<string>) {
  const notes: string[] = [];
  const country = countries.has(raw.country) ? raw.country : raw.country.toLowerCase();
  if (!countries.has(country)) notes.push(`country "${raw.country}" not in the vocabulary`);
  const category = categories.has(raw.category) ? raw.category : raw.category.toLowerCase().replace(/\s+/g, '-');
  if (!categories.has(category)) notes.push(`category "${raw.category}" not in the vocabulary`);
  const scopes = raw.scopes.filter((s) => countries.has(s));
  if (scopes.length !== raw.scopes.length) notes.push('dropped unknown scopes');
  const keptRoles = raw.roles.filter((r) => roles.has(r));
  if (keptRoles.length !== raw.roles.length) notes.push('dropped unknown roles');
  return { ...raw, country, category, scopes, roles: keptRoles, notes };
}

async function main(): Promise<void> {
  await ensurePoolDirs();
  if (!(await isServerUp())) {
    console.error('classify: Ollama is not running.');
    console.error('  ollama serve');
    process.exit(1);
  }

  const content = await loadContent();
  const countries = new Set(content.countries.keys());
  const categories = new Set(content.categories.keys());
  const roles = new Set(content.roles.keys());
  // `zz` is the global pseudo-country; give the model the word as well as the code.
  const countryList = [...countries].map((c) => (c === 'zz' ? 'zz(global)' : c));

  const pending = [...(await loadAllCandidates()).values()].filter(
    (c) => (c.stage === 'inbox' || c.stage === 'candidate') && !c.classification,
  );
  const todo = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;
  if (todo.length === 0) {
    console.log(`classify: nothing to do (${pending.length} unclassified)`);
    return;
  }

  console.log(
    `classify: ${todo.length} candidate(s), model ${MODELS.classify}, gate ${GATE}` +
      `${APPLY ? '' : '   [dry run — pass --apply to write]'}`,
  );

  const stats = { ok: 0, lowConfidence: 0, invalid: 0, errors: 0, thin: 0 };

  for (const [i, candidate] of todo.entries()) {
    // Too little surrounding text to classify honestly.
    if (wordCount(candidate.context) < 6) {
      stats.thin += 1;
      if (APPLY) await writeStage({ ...candidate, stage: 'rejected', rejected_reason: 'content-thin', notes: [...candidate.notes, 'context too thin to classify'] });
      continue;
    }

    try {
      const raw = await generateJson(
        MODELS.classify,
        buildPrompt(candidate, countryList, [...categories], [...roles]),
        (v) => classificationSchema.parse(v),
      );
      // Truncate on the way in. The model does not respect the 300-char cap,
      // and an over-long rationale made the candidate unreadable on reload.
      raw.rationale = raw.rationale.slice(0, 280);
      const result = coerce(raw, countries, categories, roles);

      if (result.country === 'zz') result.scopes = [];
      if (result.notes.length > 0) result.confidence = Math.min(result.confidence, 0.5);

      if (result.notes.length > 0) {
        stats.invalid += 1;
        console.log(`  [${i + 1}/${todo.length}] ${candidate.id} out-of-vocab: ${result.notes.join('; ')}`);
        if (APPLY) await writeStage({ ...candidate, stage: 'rejected', rejected_reason: 'low-confidence', notes: [...candidate.notes, result.notes.join('; ')] });
        continue;
      }

      if (result.confidence < GATE) {
        stats.lowConfidence += 1;
        console.log(
          `  [${i + 1}/${todo.length}] ${candidate.id} low ${result.confidence.toFixed(2)} ` +
            `${candidate.title.slice(0, 44)}`,
        );
        if (APPLY) {
          await writeStage({
            ...candidate,
            classification: { ...result, model: MODELS.classify },
            stage: 'rejected',
            rejected_reason: 'low-confidence',
            notes: [...candidate.notes, `confidence ${result.confidence} below ${GATE}`],
          });
        }
        continue;
      }

      stats.ok += 1;
      console.log(
        `  [${i + 1}/${todo.length}] ${candidate.id} ${result.country}/${result.category} ` +
          `${result.confidence.toFixed(2)}  ${candidate.title.slice(0, 44)}`,
      );
      if (APPLY) {
        await writeStage({
          ...candidate,
          classification: { ...result, model: MODELS.classify },
          stage: 'candidate',
        });
      }
    } catch (error) {
      stats.errors += 1;
      console.log(`  [${i + 1}/${todo.length}] ${candidate.id} error: ${(error as Error).message.slice(0, 90)}`);
    }
  }

  if (APPLY) {
    await writeJsonAtomic(join(POOL_DIRS.reports, 'classify.json'), { at: now(), gate: GATE, model: MODELS.classify, stats });
  }
  console.log(`classify: ${stats.ok} classified, ${stats.lowConfidence} low-confidence, ${stats.invalid} out-of-vocab, ${stats.thin} thin, ${stats.errors} error(s)`);
}

main().catch((error: Error) => {
  console.error(`classify failed: ${error.message}`);
  process.exit(1);
});
