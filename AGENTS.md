# AGENTS.md

Working contract for AI coding agents in this repository. Read this before touching content, and read the
guide you are actually about to follow — everything below points at it rather than repeating it.

## Start with the right guide

| Task | Follow |
| --- | --- |
| Add, edit or remove a link | [CONTRIBUTING.md → Add a link](CONTRIBUTING.md#add-a-link) |
| Field-by-field constraints | [CONTRIBUTING.md → Field reference](CONTRIBUTING.md#field-reference) |
| Add a country | [CONTRIBUTING.md → Add a country](CONTRIBUTING.md#add-a-country) |
| Add a category or role | [CONTRIBUTING.md → Add a category or a role](CONTRIBUTING.md#add-a-category-or-a-role) |
| Fix a dead or moved link | [CONTRIBUTING.md → Fix a dead or moved link](CONTRIBUTING.md#fix-a-dead-or-moved-link) |
| Find a gap worth filling | `make stats`, or https://awesome-expat.com/contribute |
| Suggest links without opening a PR | the local pool, below |

The binding contract for content shape is `engine/lib/schema.ts`. It is strict: a field that is not in that
file does not exist, and adding a field means adding it there first, because the CLI and the Astro site both
read it.

## The repository in one screen

```
content/links/<country>/<category>/<id>.yaml   the corpus. One file per link. The ONLY source of links.
content/countries|categories|roles|groups|authors/   registries. Unknown slugs fail validation.
engine/lib/schema.ts    every shape, in Zod. Contract, not documentation.
engine/lib/url.ts       URL canonicalisation and the dedup identity.
engine/lib/content.ts   loader, indexes, cross-reference checks.
engine/cmd/             one file per command; `make help` maps targets to them.
engine/test/            the suites `make test` runs.
src/                    Astro site. Hand-written pages that read content/ through the same schemas.
README.md, docs/**      GENERATED artifacts. Never hand-edit.
.agents/                machine-local, unvetted, gitignored. Never commit anything in here.
```

## Generated files, do not edit

`README.md`, `docs/index.md`, `docs/jobs.md` and every page under `docs/countries/` are derived from
`content/` by `engine/cmd/export-markdown.ts`. `make check` regenerates them into a scratch directory and
fails on any diff, which is how a hand edit gets caught. If one of those pages says the wrong thing, fix the
generator or the content it reads — never the Markdown.

`src/` is the opposite case: the Astro pages there are hand-written and you may edit them, but they read
`content/` through the same Zod schemas, so most content work never touches them. Prove an edit there with
`make site-check`, which builds and then checks every internal link and each page's own invariants.

## Commands

```
make setup              install dependencies (pnpm)
make validate           schema + cross-reference errors, exit 1 on errors
make check              validate + prove generated Markdown is current
make test               engine test suites
make ci                 validate + export + check + test + links-check, in one go
make export             regenerate README.md and docs/
make stats              totals, per-category, per-country, coverage gaps
make links-check        check every external URL (read-only)
make links-check-update ... and stamp last_checked on the healthy files
make dev | build | preview
make site-check         build, then check internal links and page invariants
make help               the full list
```

CI runs the link check on every push and PR (`.github/workflows/links.yml`) and deploys from `deploy.yml`.
Nothing in CI validates content or runs the test suite yet — **you** are that gate: `make ci` must pass
locally before you claim a change is done.

## Two ways to add a link

**A. Hand-authored PR** — follow the nine steps in CONTRIBUTING.md. Use this whenever a human asked you for
a specific resource and gave you a description, or you are fixing an existing entry.

**B. The local pool** — machine-drafted suggestions, quarantined under `.agents/pool/`:

```
make pool-harvest     pull candidate URLs from allow-listed sources (engine/lib/pool/sources.ts)
make pool-dedup       collapse duplicates by normalised URL
make pool-verify      check each URL is actually alive
make pool-classify    assign a country + category (Ollama)
make pool-describe    draft a description  ← always sets description_verified: false
make pool-status      what is ready, what is blocked, what is next
make pool-promote     dry-run of writing into content/
make pool-promote-apply the ONLY command that lets agent output reach content/, re-runs `make check` after
```

Every stage is dry-run by default and writes inside `.agents/pool/` only. `pool-promote-apply` refuses any
candidate whose `description_verified` is still `false`, which is a flag only a human may set. Do not work
around that gate: if it blocks, your job is to print the draft and ask the human to review it.

## Hard rules

1. **Never invent a description.** A description must come from a human or from the page you actually
   fetched. If you draft one, leave `description_verified: false` and say out loud that it is unreviewed.
2. **Never write to `content/` unless the user asked you to add or change that specific entry**, and never
   bulk-write pool output into `content/`.
3. **Never commit `.agents/`** — plans, pool candidates, `link-report.json`, everything in it is unvetted.
   One `git add .` with those staged puts machine-drafted content into permanent history.
4. **Never hand-edit `README.md` or `docs/**`.** Run `make export`.
5. **One file per link.** A resource useful in five countries is one file with `scopes:` — not five files
   that drift.
6. **URLs must be canonical** before you write them: `https://`, no `www.`, no tracking parameters, no
   trailing slash, query params sorted. `make validate` prints the form it wants; use it.
7. **Never delete a link on a 403/429.** Those mean a bot was here. Allowlist the host in
   `engine/lib/link-allowlist.yaml` only after a human confirms in a browser, or leave the link alone.
8. **`added_at` is today, and never the future.** `last_checked` is `null` unless
   `make links-check-update` stamped it.
9. **Do not touch `git push`, branch protection, or DNS.** Local commits on a branch are fine when asked.
10. **Do not add a new content field, registry kind, or Makefile target** without saying why — the schema,
    the validator, the site and the `check-phony` target all have to agree with it.

## Before you report a change as done

```
make ci                  validate + export + check + test + links-check
git status --short       nothing under .agents/ staged
```

## Known gaps

Verified on 2026-10-06 by running the commands. Do not report one of these as fixed unless you have run the
command and seen it pass.

| Gap | Symptom | Do instead |
| --- | --- | --- |
| `engine/cmd/add-link.ts` does not exist | `make add-link` fails on a missing module | write the YAML by hand, per [CONTRIBUTING.md → Add a link](CONTRIBUTING.md#add-a-link) |
| `make add-country` forwards arguments wrongly | make eats `--region=...`, then passes the bare `--` to the script as the country code | `pnpm run add-country -- --code=pt --region=europe` |
| content validation and tests are not in CI | a PR with a schema error or a stale README can still be green | run `make ci` locally, every time |
