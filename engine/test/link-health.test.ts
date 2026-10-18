import { applyAllowlist, safeHost, type ProbeResult } from '../lib/link-health.ts';

/**
 * Tests for what a failed link check is allowed to conclude.
 *
 * The bug these guard against is a bot deleting a good link. It arrived twice
 * on CI: a 403 treated as death for an allowlisted host, and then a runner's
 * `fetch failed` treated as death for a host a maintainer had already opened
 * in a browser. Both turned a healthy link red, and a red link is what prompts
 * somebody to remove it.
 *
 * The rule under test is narrow on purpose: only a received status code can
 * condemn a link. Bot-walls and our own transport failures cannot.
 */
export const name = 'link-health';
export type Check = (label: string, actual: unknown, expected: unknown) => void;

const result = (over: Partial<ProbeResult>): ProbeResult => ({
  url: 'https://example.com/',
  finalUrl: null,
  status: null,
  state: 'ok',
  detail: '',
  ...over,
});

export async function run(check: Check) {
  const allowlist = { 'example.com': 'confirmed in a browser' };

  // --- safeHost ----------------------------------------------------------
  check('lowercases the host', safeHost('https://Example.COM/a'), 'example.com');
  check('keeps the port', safeHost('https://example.com:8443/'), 'example.com:8443');
  check('never throws on junk', safeHost('not a url'), 'not a url');

  // --- bot-walls stay alive ---------------------------------------------
  const blocked: ProbeResult[] = [
    result({ url: 'https://example.com/', status: 403, state: 'blocked', detail: '403 — bot-walled' }),
  ];
  applyAllowlist(blocked, allowlist);
  check('a 403 on an allowlisted host is healthy', blocked[0]!.state, 'ok');
  check('and says why', blocked[0]!.detail, 'blocked, allowlisted (confirmed in a browser)');

  // --- transport failures stay alive ------------------------------------
  // No status at all: this is our network, not the page.
  const unreachable: ProbeResult[] = [
    result({ url: 'https://example.com/', status: null, state: 'dead', detail: 'fetch failed' }),
  ];
  applyAllowlist(unreachable, allowlist);
  check('an unreachable allowlisted host is healthy', unreachable[0]!.state, 'ok');
  check('and does not claim to be ok', unreachable[0]!.detail, 'unreachable from here, allowlisted (confirmed in a browser)');

  // --- but rot is still reported ----------------------------------------
  // The status code is an answer about the page. The allowlist does not buy
  // immunity from a 404, only from bot-walls and from our own flaky network.
  const rot: ProbeResult[] = [
    result({ url: 'https://example.com/', status: 404, state: 'dead', detail: '404 Not Found' }),
  ];
  applyAllowlist(rot, allowlist);
  check('a 404 on an allowlisted host is still dead', rot[0]!.state, 'dead');

  const serverError: ProbeResult[] = [
    result({ url: 'https://example.com/', status: 500, state: 'dead', detail: '500 Internal Server Error' }),
  ];
  applyAllowlist(serverError, allowlist);
  check('a 500 on an allowlisted host is still dead', serverError[0]!.state, 'dead');

  // --- hosts that are not allowlisted are untouched ---------------------
  // An unreachable host that nobody has vouched for still comes back
  // `unreachable`, not `dead`. That difference is what keeps CI honest: no
  // answer from here is not an answer about the page.
  const unknown: ProbeResult[] = [
    result({ url: 'https://stranger.example/', status: null, state: 'unreachable', detail: 'fetch failed' }),
    result({ url: 'https://stranger.example/', status: 403, state: 'blocked', detail: '403' }),
  ];
  applyAllowlist(unknown, allowlist);
  check('an unreachable unknown host is not promoted', unknown[0]!.state, 'unreachable');
  check('an unknown bot-wall is still reported', unknown[1]!.state, 'blocked');

  // --- and a DNS answer still condemns ----------------------------------
  // A name that does not resolve is an answer, unlike a reset socket.
  const noDns: ProbeResult[] = [
    result({ url: 'https://stranger.example/', status: null, state: 'dead', detail: 'DNS does not resolve' }),
  ];
  applyAllowlist(noDns, allowlist);
  check('a name that does not resolve stays dead', noDns[0]!.state, 'dead');

  // --- healthy results are left alone -----------------------------------
  const healthy: ProbeResult[] = [
    result({ url: 'https://example.com/', status: 200, state: 'ok', detail: '200' }),
    result({ url: 'https://example.com/', status: 200, state: 'redirected', detail: 'redirects' }),
    result({ url: 'https://stranger.example/', status: 301, state: 'redirected', detail: 'redirects' }),
  ];
  applyAllowlist(healthy, allowlist);
  check('an ok link keeps its detail', healthy[0]!.detail, '200');
  check('a redirected link stays redirected', healthy[1]!.state, 'redirected');
  check('a redirect on an unknown host stays redirected', healthy[2]!.state, 'redirected');
}