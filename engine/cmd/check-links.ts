import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ROOT, loadContent } from '../lib/content.ts';
import { normaliseUrl } from '../lib/url.ts';
import { applyAllowlist, safeHost, type LinkState, type ProbeResult } from '../lib/link-health.ts';

/**
 * Link health checker.
 *
 * The rule that makes this trustworthy: a link is dead only when it is
 * provably gone. 403 and 429 mean "a bot was here", not "the page is gone",
 * and treating them as death is how a link-checking bot quietly deletes a
 * third of a good directory. Those go in an explicit allowlist instead.
 *
 * The same reasoning covers a request that never got an answer at all. A
 * dropped socket or a runner with no route to the host says nothing about the
 * page, so those are retried and, for an allowlisted host, excused. Only a real
 * status code can condemn a link. The classification itself lives in
 * engine/lib/link-health.ts, where it is tested.
 */

const ALLOWLIST_PATH = 'engine/lib/link-allowlist.yaml';
const REPORT_PATH = '.agents/link-report.json';

const TIMEOUT_MS = 15_000;
const CONCURRENCY = 6;
const PER_HOST_DELAY_MS = 1_000;

/**
 * Retries for a transport failure, i.e. no HTTP response at all. Three rounds
 * with a growing gap is enough to ride out a dropped socket or a blackholed
 * IPv6 route without turning the check into a crawl.
 */
const RETRY_ROUNDS = 3;
const RETRY_BACKOFF_MS = 2_000;

type Status = LinkState;

/** A probe outcome plus the content file it came from. */
type Result = ProbeResult & { file: string | null };

const args = new Set(process.argv.slice(2));
const shouldUpdate = args.has('--update');
const reportOnly = args.has('--report');

const inCI = process.env.GITHUB_ACTIONS === 'true';
function annotate(level: 'error' | 'warning', title: string, file: string | null, message: string) {
  if (!inCI) return;
  const where = file ? `file=${file},` : '';
  const safe = message.replace(/\n/g, '%0A');
  process.stdout.write(`::${level} ${where}title=${title}::${safe}\n`);
}

/** Simple per-host throttle so we never hammer one server. */
const lastHit = new Map<string, number>();
async function throttle(host: string) {
  const previous = lastHit.get(host) ?? 0;
  const wait = previous + PER_HOST_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

async function probe(url: string): Promise<Omit<Result, 'file'>> {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    return { url, finalUrl: null, status: null, state: 'error', detail: 'unparseable URL' };
  }

  await throttle(host);

  // `responses` counts HTTP replies actually received. Zero means we never got
  // to speak HTTP at all -- a reset socket, a TLS failure, a runner with no
  // route -- which is not evidence about the page. See the retry loop below.
  let responses = 0;

  // HEAD is cheap but some hosts reject it, so fall back to a ranged GET.
  const attempts: Array<{ method: 'HEAD' | 'GET'; headers: Record<string, string> }> = [
    {
      method: 'HEAD',
      headers: { 'user-agent': 'awesome-expat-link-check/1.0 (+https://awesome-expat.com)', accept: '*/*' },
    },
    {
      method: 'GET',
      headers: {
        'user-agent': 'awesome-expat-link-check/1.0 (+https://awesome-expat.com)',
        accept: '*/*',
        range: 'bytes=0-0',
      },
    },
  ];

  let lastDetail = '';
  for (const attempt of attempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: attempt.method,
        redirect: 'follow',
        signal: controller.signal,
        headers: attempt.headers,
      });
      clearTimeout(timer);
      responses++;

      const finalUrl = response.url || null;
      const canonicalInput = normaliseUrl(url);
      const canonicalFinal = finalUrl ? normaliseUrl(finalUrl) : null;
      const moved = Boolean(canonicalInput && canonicalFinal && canonicalInput !== canonicalFinal);

      if (response.status === 403 || response.status === 429 || response.status === 401) {
        return {
          url,
          finalUrl,
          status: response.status,
          state: 'blocked',
          detail: `${response.status} — bot-walled, needs manual check`,
        };
      }

      if (response.ok) {
        return {
          url,
          finalUrl,
          status: response.status,
          state: moved ? 'redirected' : 'ok',
          detail: moved ? `redirects to ${finalUrl}` : String(response.status),
        };
      }

      lastDetail = `${response.status} ${response.statusText}`.trim();
      if (response.status >= 400 && response.status < 500 && response.status !== 404) {
        // 410 is a definite "gone"; other 4xx are ambiguous, so try GET.
        lastDetail = `${response.status} on ${attempt.method}`;
      }
    } catch (cause) {
      clearTimeout(timer);
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/abort/i.test(message)) return { url, finalUrl: null, status: null, state: 'error', detail: `timeout after ${TIMEOUT_MS}ms` };
      // EAI_AGAIN is the resolver saying "try again later", not "no such
      // host". ENOTFOUND is an answer; a temporary failure is not.
      if (/EAI_AGAIN/i.test(message)) {
        lastDetail = `DNS temporary failure: ${message}`;
      } else if (/getaddrinfo|ENOTFOUND/i.test(message)) {
        return { url, finalUrl: null, status: null, state: 'dead', detail: 'DNS does not resolve' };
      } else {
        lastDetail = message;
      }
    }

    // No HTTP reply at all on either method: the runner's network failed, not
    // the page. Undi's `fetch failed` is famously a reset socket, a TLS
    // handshake dropped mid-run, or an IPv6 route that blackholes. Retry with
    // backoff before concluding anything, or a single flaky socket turns a
    // good link red on CI and invites a maintainer to delete it.
    if (responses === 0 && attempt === attempts[attempts.length - 1]) {
      for (let round = 1; round < RETRY_ROUNDS; round++) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS * round));
        try {
          const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: attempts[1].headers,
          });
          responses++;
          const finalUrl = response.url || null;
          const canonicalInput = normaliseUrl(url);
          const canonicalFinal = finalUrl ? normaliseUrl(finalUrl) : null;
          const moved = Boolean(canonicalInput && canonicalFinal && canonicalInput !== canonicalFinal);
          if (response.status === 403 || response.status === 429 || response.status === 401) {
            return { url, finalUrl, status: response.status, state: 'blocked', detail: `${response.status} — bot-walled, needs manual check` };
          }
          if (response.ok) {
            return { url, finalUrl, status: response.status, state: moved ? 'redirected' : 'ok', detail: moved ? `redirects to ${finalUrl}` : String(response.status) };
          }
          // An actual status code is an answer about the page. Take it.
          return { url, finalUrl, status: response.status, state: 'dead', detail: `${response.status} ${response.statusText}`.trim() };
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (/getaddrinfo|ENOTFOUND/i.test(message)) {
            // DNS is not flaking: there is no such host. Retrying proves nothing.
            return { url, finalUrl: null, status: null, state: 'dead', detail: 'DNS does not resolve' };
          }
          lastDetail = message;
        }
      }
      break;
    }
  }

  // Two exits, and the difference is whether we ever got an answer. If any
  // attempt reached HTTP, the last status is the server's verdict and the link
  // is dead. If nothing did, we are describing our own network, which is
  // `unreachable` and non-fatal.
  return {
    url,
    finalUrl: null,
    status: null,
    state: responses > 0 ? 'dead' : 'unreachable',
    detail: lastDetail || 'no response',
  };
}

async function loadAllowlist(): Promise<{ [host: string]: string }> {
  try {
    return parseYaml(await readFile(join(ROOT, ALLOWLIST_PATH), 'utf8')) as { [host: string]: string };
  } catch {
    return {};
  }
}

async function main() {
  const content = await loadContent();
  const allowlist = await loadAllowlist();
  const today = new Date().toISOString().slice(0, 10);

  const targets = content.links.map(({ data, file }) => ({ url: data.url as string, file }));
  if (targets.length === 0) {
    console.log('links: no links to check');
    return;
  }

  console.log(`links: checking ${targets.length} URLs with concurrency ${CONCURRENCY}\n`);

  const results: Result[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
    while (cursor < targets.length) {
      const index = cursor++;
      const target = targets[index]!;
      const result = await probe(target.url);
      results.push({ ...result, file: target.file });

      const host = safeHost(target.url);
      const known = allowlist[host];
      const mark =
        result.state === 'ok' ? 'ok  ' : result.state === 'redirected' ? '->  ' : result.state === 'blocked' ? (known ? 'blkd' : 'BLKD') : result.state === 'unreachable' ? 'UNRE' : 'DEAD';
      process.stdout.write(`  ${mark} ${target.url}\n`);
    }
  });
  await Promise.all(workers);

  // Allowlisted hosts get downgraded from an error to a note.
  applyAllowlist(results, allowlist);

  await mkdir(join(ROOT, '.agents'), { recursive: true });
  await writeFile(
    join(ROOT, REPORT_PATH),
    JSON.stringify({ generated: new Date().toISOString(), results }, null, 2),
    'utf8',
  );

  if (shouldUpdate && !reportOnly) {
    await updateCheckDates(results, today);
  }

  const tally = results.reduce<Record<Status, number>>(
    (acc, r) => ({ ...acc, [r.state]: (acc[r.state] ?? 0) + 1 }),
    {} as Record<Status, number>,
  );
  console.log('\nlinks: ' + Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', '));

  // Only a received answer is fatal. `unreachable` means every attempt failed
  // before HTTP, which is a fact about this runner; failing the run on it is
  // what marked a live link dead on CI twice.
  const fatal = results.filter((r) => r.state === 'dead' || r.state === 'error');

  // Surface findings in the PR too: an error on anything that is not a 2xx, a
  // warning on the two healthy-but-noteworthy cases (a redirect we followed,
  // and a bot-walled host that has not been allowlisted yet). Local runs print
  // the same states in the tally above and never emit these markers.
  for (const r of results) {
    if (r.state === 'dead') annotate('error', 'Dead link', r.file, `${r.url} — ${r.detail}`);
    else if (r.state === 'error') annotate('error', 'Link check error', r.file, `${r.url} — ${r.detail}`);
    else if (r.state === 'unreachable')
      annotate('warning', 'Unreachable from this runner', r.file, `${r.url} — ${r.detail} (no HTTP response; not evidence the page is gone)`);
    else if (r.state === 'redirected')
      annotate('warning', 'Redirect followed', r.file, `${r.url} redirects to ${r.finalUrl ?? 'unknown'}`);
    else if (r.state === 'blocked')
      annotate('warning', 'Bot-walled (needs manual check)', r.file, `${r.url} returned ${r.status ?? '?'} and is not allowlisted`);
  }

  if (fatal.length) {
    console.log(`\n${fatal.length} URL(s) need attention:`);
    for (const r of fatal) console.log(`  ${r.file ?? '-'}\n    ${r.url}\n    ${r.detail}`);
  }
  if (fatal.length) process.exit(1);
}

/** Stamp `last_checked` on every file that came back clean. */
async function updateCheckDates(results: Result[], today: string) {
  const byFile = new Map<string, Result>();
  for (const result of results) {
    if (!result.file) continue;
    if (result.state !== 'ok' && result.state !== 'redirected') continue;
    byFile.set(result.file, result);
  }

  let updated = 0;
  for (const [file, result] of byFile) {
    const abs = join(ROOT, file);
    const doc = parseYaml(await readFile(abs, 'utf8')) as Record<string, unknown>;
    if (doc.last_checked === today) continue;

    // Preserve field order: `last_checked` sits next to `added_at`.
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(doc)) {
      next[key] = value;
      if (key === 'added_at') next.last_checked = today;
    }
    if (!('last_checked' in next)) next.last_checked = today;
    if (result.state === 'redirected' && result.finalUrl) {
      // Do not rewrite the URL automatically: a redirect may be temporary and
      // silently swapping it is how a directory accumulates link rot.
      console.log(`  note: ${file} redirects -> ${result.finalUrl} (review manually)`);
    }

    await writeFile(abs, `---\n${stringifyYaml(next, { indent: 2, lineWidth: 0 })}`, 'utf8');
    updated += 1;
  }
  console.log(`links: stamped last_checked on ${updated} file(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
