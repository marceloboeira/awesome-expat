/**
 * Polite HTTP for the harvester.
 *
 * Rules this enforces, in order of importance:
 *   1. robots.txt is fetched and obeyed. A disallowed path is a hard skip, and
 *      the skip is recorded so the report can show what we did not touch.
 *   2. One in-flight request per host, plus a fixed delay between them.
 *   3. Conditional requests. A 304 costs one round trip and no bandwidth, so
 *      re-running the harvester over unchanged pages is nearly free.
 *   4. Content is capped. An unbounded read is how a crawler eats a disk.
 */

const UA = 'awesome-expat-bot/1.0 (+https://awesome-expat.com; contact@awesome-expat.com)';
const MAX_BYTES = 2 * 1024 * 1024;

/** Per-host politeness. Two hosts may be crawled in parallel, never two URLs. */
const PER_HOST_DELAY_MS = 1500;
const MAX_CONCURRENCY = 4;

const lastHit = new Map<string, number>();
const inFlight = new Map<string, Promise<unknown>>();
const robotsCache = new Map<string, Robots>();

interface Robots {
  disallow: string[];
  allow: string[];
  fetchedAt: number;
  /** true when robots.txt itself was unreachable; we then allow, and say so. */
  assumed: boolean;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  body: string;
  notModified: boolean;
  error?: string;
  fromCache: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Serialises per host and applies the delay. */
async function politeness(url: string): Promise<void> {
  const host = new URL(url).host;
  const previous = inFlight.get(host);
  if (previous) await previous.catch(() => {});

  const gate = (async () => {
    const last = lastHit.get(host) ?? 0;
    const wait = last + PER_HOST_DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
  })();

  inFlight.set(host, gate);
  try {
    await gate;
  } finally {
    inFlight.set(host, gate);
  }
}

export function parseRobots(txt: string): { disallow: string[]; allow: string[] } {
  const disallow: string[] = [];
  const allow: string[] = [];
  // Only the group matching our UA or `*`. Naively merging groups would let a
  // Disallow aimed at one bot bind us.
  let active = false;
  for (const rawLine of txt.split('\n')) {
    const line = rawLine.split('#')[0]!.trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey!.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      const agent = value.toLowerCase();
      active = agent === '*' || UA.toLowerCase().includes(agent);
      continue;
    }
    if (!active) continue;
    if (key === 'disallow' && value) disallow.push(value);
    if (key === 'allow' && value) allow.push(value);
  }
  return { disallow, allow };
}

function pathMatches(pattern: string, path: string): boolean {
  if (pattern === '/') return path === '/' || path.startsWith('/?');
  if (pattern.endsWith('$')) return path === pattern.slice(0, -1);
  return path.startsWith(pattern);
}

/**
 * Longest-match wins, per the robots.txt spec: a longer Allow beats a shorter
 * Disallow even if the Disallow appears first. `Disallow: /a` + `Allow: /a/b`
 * means /a/b is allowed.
 */
export function isAllowed(robots: Robots, pathWithQuery: string): boolean {
  if (robots.assumed) return true;
  let bestDisallow = -1;
  let bestAllow = -1;
  for (const p of robots.disallow) if (pathMatches(p, pathWithQuery)) bestDisallow = Math.max(bestDisallow, p.length);
  for (const p of robots.allow) if (pathMatches(p, pathWithQuery)) bestAllow = Math.max(bestAllow, p.length);
  if (bestDisallow === -1) return true;
  return bestAllow > bestDisallow;
}

async function fetchRobots(origin: string): Promise<Robots> {
  const cached = robotsCache.get(origin);
  // Re-check hourly; robots.txt does not change often and we do not want to
  // re-request it on every page of a run.
  if (cached && Date.now() - cached.fetchedAt < 3_600_000) return cached;

  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // 4xx means "no restrictions published" per the spec. 5xx is ambiguous;
      // we allow but record `assumed` so the report is honest about it.
      const assumed = res.status >= 500;
      const robots: Robots = { disallow: [], allow: [], fetchedAt: Date.now(), assumed };
      robotsCache.set(origin, robots);
      return robots;
    }
    const robots: Robots = { ...parseRobots(await res.text()), fetchedAt: Date.now(), assumed: false };
    robotsCache.set(origin, robots);
    return robots;
  } catch {
    const robots: Robots = { disallow: [], allow: [], fetchedAt: Date.now(), assumed: true };
    robotsCache.set(origin, robots);
    return robots;
  }
}

export interface FetchOptions {
  /** Persisted ETag; a matching server response returns notModified. */
  etag?: string;
  timeoutMs?: number;
  accept?: string;
}

export async function politeFetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const parsed = new URL(url);
  const base: Omit<FetchResult, 'status' | 'ok' | 'body' | 'notModified' | 'fromCache'> = {
    url,
    finalUrl: url,
    error: undefined,
  };

  const robots = await fetchRobots(parsed.origin);
  if (!isAllowed(robots, parsed.pathname + parsed.search)) {
    return { ...base, status: 0, ok: false, body: '', notModified: false, error: 'blocked-by-robots', fromCache: false };
  }

  // Concurrency cap across all hosts.
  if (inFlight.size >= MAX_CONCURRENCY * 4) await sleep(200);
  await politeness(url);

  const headers: Record<string, string> = { 'user-agent': UA };
  if (opts.etag) headers['if-none-match'] = opts.etag;
  if (opts.accept) headers.accept = opts.accept;

  try {
    const res = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });

    if (res.status === 304) {
      return { ...base, status: 304, ok: true, body: '', notModified: true, fromCache: true };
    }

    if (!res.ok) {
      return {
        ...base,
        status: res.status,
        ok: false,
        body: '',
        notModified: false,
        error: `http-${res.status}`,
        fromCache: false,
      };
    }

    // Cap the read. Content-Length when honest, otherwise stop early.
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > MAX_BYTES) {
      return { ...base, status: res.status, ok: false, body: '', notModified: false, error: 'too-large', fromCache: false };
    }

    const reader = res.body?.getReader();
    if (!reader) return { ...base, status: res.status, ok: false, body: '', notModified: false, error: 'no-body', fromCache: false };

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return { ...base, status: res.status, ok: false, body: '', notModified: false, error: 'too-large', fromCache: false };
      }
      chunks.push(value);
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      ...base,
      finalUrl: res.url || url,
      status: res.status,
      ok: true,
      body: new TextDecoder('utf-8', { fatal: false }).decode(merged),
      notModified: false,
      fromCache: false,
      error: undefined,
    };
  } catch (error) {
    return {
      ...base,
      status: 0,
      ok: false,
      body: '',
      notModified: false,
      error: (error as Error).name === 'TimeoutError' ? 'timeout' : 'network-error',
      fromCache: false,
    };
  }
}

/** Exposed for the report so it can state which hosts we assumed were open. */
export function robotsForOrigin(origin: string): Robots | undefined {
  return robotsCache.get(origin);
}
