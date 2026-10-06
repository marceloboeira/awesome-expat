import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensurePoolDirs, POOL_DIRS } from '../lib/pool/store.ts';
import { loadAllCandidates, loadCursors, loadSeen } from '../lib/pool/pool.ts';
import { loadContent, ROLE_PAGE_THRESHOLD } from '../lib/content.ts';
import { isServerUp, listModels } from '../lib/pool/ollama.ts';
import { SOURCES } from '../lib/pool/sources.ts';
import { normaliseUrl } from '../lib/url.ts';
import { titleKey } from '../lib/pool/store.ts';

/**
 * One screen covering the whole pipeline: what is published, what the pool is
 * holding, and where each candidate is stuck.
 *
 * Read-only. Safe to run at any time, which is the point — it is the command
 * you run to decide whether the next command should be `--apply`.
 */

async function main(): Promise<void> {
  await ensurePoolDirs();

  const content = await loadContent();
  const published = content.links.length;
  const byCategory = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const byRole = new Map<string, number>();
  const publishedUrls = new Set<string>();
  const publishedTitles = new Set<string>();

  for (const { data } of content.links) {
    byCategory.set(data.category, (byCategory.get(data.category) ?? 0) + 1);
    byCountry.set(data.country, (byCountry.get(data.country) ?? 0) + 1);
    for (const role of data.roles) byRole.set(role, (byRole.get(role) ?? 0) + 1);
    const clean = normaliseUrl(data.url);
    if (clean) publishedUrls.add(clean);
    publishedTitles.add(titleKey(data.title));
  }

  const candidates = await loadAllCandidates();
  const stages = { inbox: 0, candidate: 0, draft: 0, rejected: 0 };
  const rejectReasons = new Map<string, number>();
  const descriptions: string[] = [];
  let awaitingHuman = 0;
  let thinContext = 0;

  for (const c of candidates.values()) {
    stages[c.stage] += 1;
    if (c.stage === 'rejected' && c.rejected_reason) {
      rejectReasons.set(c.rejected_reason, (rejectReasons.get(c.rejected_reason) ?? 0) + 1);
    }
    if (c.context.trim().split(/\s+/).filter(Boolean).length < 6) thinContext += 1;
    if (c.stage === 'draft' && !c.description_verified) {
      awaitingHuman += 1;
      if (descriptions.length < 5) {
        descriptions.push(
          `  ${c.id}  ${c.classification?.country ?? '?'}/${c.classification?.category ?? '?'}  ${c.title.slice(0, 44)}\n` +
            `      draft: ${(c.description?.text ?? '(none)').slice(0, 100)}\n` +
            `      edit ${c.id}.json, set "description_verified": true, then: make pool:promote-apply`,
        );
      }
    }
  }

  const seen = await loadSeen();
  const cursors = await loadCursors();
  const server = await isServerUp();
  const models = server ? await listModels() : [];

  const line = (label: string, value: string) => console.log(label.padEnd(34) + value);

  console.log('\nPUBLISHED');
  line('  links', String(published));
  line('  countries / categories / roles', `${byCountry.size} / ${byCategory.size} / ${byRole.size}`);
  line('  posts', String(content.posts.length));
  line('  validation issues', String(content.issues.length));
  line('  role pages below threshold', [...content.roles.keys()].filter((r) => (byRole.get(r) ?? 0) < ROLE_PAGE_THRESHOLD).join(', ') || 'none');

  console.log('\nPOOL');
  line('  total candidates', String(candidates.size));
  line('  inbox (unclassified)', String(stages.inbox));
  line('  candidate (classified)', String(stages.candidate));
  line('  draft (has description)', String(stages.draft));
  line('  rejected', String(stages.rejected));
  line('  awaiting human verification', String(awaitingHuman));
  line('  with thin context', String(thinContext));
  line('  seen ledger', `${Object.keys(seen.urls).length} url(s), ${Object.keys(seen.titles).length} title(s)`);
  line('  sources configured', String(SOURCES.filter((s) => s.maxPages > 0).length));

  if (rejectReasons.size > 0) {
    console.log('\n  rejections by reason');
    for (const [reason, n] of [...rejectReasons].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${reason}`);
    }
  }

  console.log('\nENVIRONMENT');
  line('  ollama', server ? 'up' : 'DOWN  (ollama serve)');
  if (server) line('  models', models.map((m) => m.name).join(', ') || 'none pulled');

  const lastRun = Object.entries(cursors.last_run).sort((a, b) => b[1].localeCompare(a[1]))[0];
  if (lastRun) {
    console.log('\nLAST HARVEST');
    line('  source', lastRun[0]);
    line('  at', lastRun[1]);
  }

  if (descriptions.length > 0) {
    console.log('\nREADY FOR REVIEW');
    for (const d of descriptions) console.log(d);
  }
  console.log('');
}

main().catch((error: Error) => {
  console.error(`pool:status failed: ${error.message}`);
  process.exit(1);
});
