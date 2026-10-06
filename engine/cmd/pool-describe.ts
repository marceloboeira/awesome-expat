import { z } from 'zod';
import { join } from 'node:path';
import { ensurePoolDirs, POOL_DIRS, writeJsonAtomic } from '../lib/pool/store.ts';
import { loadAllCandidates, writeStage } from '../lib/pool/pool.ts';
import { generateJson, isServerUp, MODELS } from '../lib/pool/ollama.ts';
import { wordCount } from '../lib/pool/extract.ts';
import type { PoolCandidate } from '../lib/pool/schema.ts';

/**
 * Draft a description for a classified candidate.
 *
 * The output is ALWAYS `description_verified: false`, and that flag is what
 * `pool-promote` refuses to cross. A human reads the draft, edits it, and sets
 * the flag. This is the load-bearing safety property of the whole pool: the
 * model can fill the pipeline but cannot publish.
 *
 * The model is also told to refuse. `refuse: true` is a first-class outcome,
 * not a failure — a link with no usable evidence ("Contact", "Births, death,
 * marriages") is better left out than given a plausible invention.
 */

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [k, v = 'true'] = arg.replace(/^--/, '').split('=');
  args.set(k!, v);
}
const APPLY = args.get('apply') === 'true';
const LIMIT = Number(args.get('limit') ?? '0');

const draftSchema = z.object({
  description: z.string(),
  refuse: z.boolean().default(false),
  reason: z.string().default(''),
});

function prompt(c: PoolCandidate): string {
  const cls = c.classification!;
  return [
    'You write one-sentence descriptions for an expat reference site. JSON only.',
    '',
    'Rules:',
    '- Describe what the reader will actually get from the page. No marketing.',
    '- One sentence, under 200 characters, no trailing full stop needed.',
    '- Use only the evidence below. Do not guess specifics that are not stated.',
    '- If the evidence is too thin to write an honest sentence, set refuse=true.',
    '  An index page, a contact form, or a bare nav link is not a resource.',
    '',
    `Title: ${c.title}`,
    `URL: ${c.url}`,
    `Category: ${cls.category}`,
    `Country: ${cls.country}`,
    `Context from the page that linked here: ${c.context.slice(0, 400)}`,
    '',
    'Answer with: {"description":"..","refuse":false,"reason":""}',
  ].join('\n');
}

async function main(): Promise<void> {
  await ensurePoolDirs();
  if (!(await isServerUp())) {
    console.error('describe: Ollama is not running.  ollama serve');
    process.exit(1);
  }

  const all = await loadAllCandidates();
  const todo = [...all.values()].filter((c) => c.stage === 'candidate' && c.classification && !c.description);
  const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;

  console.log(
    `describe: ${batch.length} candidate(s), model ${MODELS.describe}${APPLY ? '' : '   [dry run]'}`,
  );
  const stats = { drafted: 0, refused: 0, errors: 0, thin: 0 };

  for (const [i, candidate] of batch.entries()) {
    // The evidence gate. Same threshold as classify, for the same reason: a
    // title alone cannot support an honest sentence.
    if (wordCount(candidate.context) < 6) {
      stats.thin += 1;
      if (APPLY) {
        await writeStage({
          ...candidate,
          stage: 'rejected',
          rejected_reason: 'content-thin',
          notes: [...candidate.notes, 'context too thin to describe'],
        });
      }
      continue;
    }

    try {
      const raw = await generateJson(MODELS.describe, prompt(candidate), (v) => draftSchema.parse(v));
      const tag = `[${i + 1}/${batch.length}] ${candidate.id}`;

      if (raw.refuse || raw.description.trim().length < 10) {
        stats.refused += 1;
        console.log(`  ${tag} REFUSED ${candidate.title.slice(0, 44)}${raw.reason ? ' — ' + raw.reason : ''}`);
        if (APPLY) {
          await writeStage({
            ...candidate,
            stage: 'rejected',
            rejected_reason: 'not-a-resource',
            notes: [...candidate.notes, `describer refused${raw.reason ? ': ' + raw.reason : ''}`],
          });
        }
        continue;
      }

      stats.drafted += 1;
      console.log(`  ${tag} ${raw.description.trim().slice(0, 96)}`);
      if (APPLY) {
        await writeStage({
          ...candidate,
          description: { text: raw.description.trim(), model: MODELS.describe, generated_at: new Date().toISOString() },
          stage: 'draft',
          // Explicit, and the only place this is ever set. A human flips it.
          description_verified: false,
        });
      }
    } catch (error) {
      stats.errors += 1;
      console.log(`  [${i + 1}/${batch.length}] ${candidate.id} error: ${(error as Error).message.slice(0, 90)}`);
    }
  }

  if (APPLY) {
    await writeJsonAtomic(join(POOL_DIRS.reports, 'describe.json'), { at: new Date().toISOString(), model: MODELS.describe, stats });
  }
  console.log(`describe: ${stats.drafted} drafted, ${stats.refused} refused, ${stats.thin} thin, ${stats.errors} error(s)`);
}

main().catch((error: Error) => {
  console.error(`describe failed: ${error.message}`);
  process.exit(1);
});
