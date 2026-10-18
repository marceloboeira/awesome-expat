/**
 * Classification rules for the link checker, kept out of the command so they
 * can be tested.
 *
 * `check-links.ts` does the fetching; this decides what a fetch means. The
 * distinction that matters throughout: a link is dead only when something
 * *proved* it. A bot-wall is not proof, and neither is our own network giving
 * up on the way to the server.
 */

/**
 * `dead` and `unreachable` are the two ways to be absent, and the difference is
 * the whole point of this file.
 *
 *  - `dead` -- we received an answer. A 404, a 410, or a name that does not
 *    resolve. Something spoke about the page and said it is gone.
 *  - `unreachable` -- nothing came back. Reset socket, TLS handshake dropped,
 *    blackholed IPv6 route, a runner with no route to that host at all. This
 *    says something about where *we* were standing, not about the page.
 *
 * Only `dead` is fatal. An `unreachable` link surfaces as a warning on every
 * run, so a host that is genuinely gone does not vanish quietly -- it stays
 * visible, and it is never deleted by a bot that tripped over its own network.
 */
export type LinkState = 'ok' | 'redirected' | 'blocked' | 'dead' | 'unreachable' | 'error';

export interface ProbeResult {
  url: string;
  finalUrl: string | null;
  /** The HTTP status we received, or null when no response arrived at all. */
  status: number | null;
  state: LinkState;
  detail: string;
}

/** Host of a URL, lowercased, for allowlist lookup. Never throws. */
export function safeHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
}

/**
 * Downgrade results the allowlist vouches for.
 *
 * Two cases:
 *
 *  1. `blocked` -- the host answered 403/429/401. An allowlist entry exists
 *     precisely for this, and records that a human opened the page in a
 *     browser and found it alive.
 *  2. `dead` with `status === null` -- no HTTP reply arrived, so the only
 *     evidence is that *our* request failed. CI hit this on teleport.org: a
 *     runner that got `fetch failed` from a host already confirmed in a
 *     browser, turning the run red and leaving a good link one careless
 *     "remove the dead link" away from gone.
 *
 * Deliberately narrow. An allowlisted host that answers a real 404 still comes
 * back `dead`, because a status code *is* an answer about the page. The
 * allowlist buys a host immunity from bot-walls and from our own flaky network,
 * not from rot.
 */
export function applyAllowlist(results: ProbeResult[], allowlist: { [host: string]: string }): void {
  for (const result of results) {
    const host = safeHost(result.url);
    const reason = allowlist[host];
    if (!reason) continue;
    if (result.state === 'blocked') {
      result.state = 'ok';
      result.detail = `blocked, allowlisted (${reason})`;
    } else if (result.state === 'dead' && result.status === null) {
      result.state = 'ok';
      result.detail = `unreachable from here, allowlisted (${reason})`;
    }
  }
}