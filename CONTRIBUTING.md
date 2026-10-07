# Contributing

Every link on [awesome-expat.com](https://awesome-expat.com) comes from a YAML file in `content/`.
There is no web form and no database, and that is deliberate: a link is content, content belongs in version
control, where it is reviewable, diffable, and never lost to a spam cleanup.

This file is the step-by-step guide, for humans. If you are working with an AI coding agent, have it read
[AGENTS.md](AGENTS.md) instead — it points back at the steps below and adds the rules that only apply to agents.

## Table of contents

- [Add a link](#add-a-link) — the main one, nine steps
- [Field reference](#field-reference)
- [Add a country](#add-a-country)
- [Add a category or a role](#add-a-category-or-a-role)
- [Fix a dead or moved link](#fix-a-dead-or-moved-link)
- [Content rules that get a PR closed](#content-rules-that-get-a-pr-closed)
- [Git workflow](#git-workflow)

## Prerequisites

Node 22+ and pnpm. Then:

```
make setup   # pnpm install
make help    # every task in the repo, one screen
```

## Add a link

### 1. Check it is not already here

Duplicates are the most common rejection. Two links that differ only by `www.`, a trailing slash or a `utm_`
parameter count as one link, and the validator will reject the second file.

```
grep -ril "example.com" content/links/   # by domain
make list                                # what exists, counted by country and category
```

Or search the site: https://awesome-expat.com/search/.

### 2. Decide the country

The file lives in **one** directory, under its primary country.

| Situation | What to do |
| --- | --- |
| Useful in one country | `country: <iso-3166-alpha-2>`, e.g. `de` |
| Useful in several countries | File it under the primary country and list all of them in `scopes:` — never copy the file |
| Useful anywhere (Wise, Numbeo, Duolingo, Airbnb) | `country: global` |

`global` is a pseudo-country, not a real one. Do not file a country-independent resource under your own
country just to give it a home.

The country must be registered in `content/countries/` (152 are). If yours is missing, [add it](#add-a-country)
first.

### 3. Decide the category

Categories are a controlled vocabulary; an unknown slug fails validation.

| Slug | Name | For |
| --- | --- | --- |
| `housing` | Housing | Finding, renting and buying a place to live |
| `jobs` | Jobs & Work | Finding work, freelancing, remote opportunities |
| `taxes` | Taxes | Tax registration, filing deadlines, government portals |
| `healthcare` | Health & Insurance | Public healthcare, private insurance, pharmacies |
| `finances` | Finances & Banking | Bank accounts, transfers, budgeting |
| `visa` | Visas & Residency | Visas, residence permits, renewals |
| `permanent-residency` | Permanent Residency | Long-term residence and settlement |
| `citizenship` | Citizenship | Routes to citizenship and what they require |
| `moving` | Moving | Shipping, customs, relocation logistics |
| `interviewing` | Interviewing | CVs, interviews, local hiring process |
| `community` | Community & Groups | Meetups, expat groups, forums |
| `education` | Learning & Language | Language courses, universities, integration |

### 4. Create the file

One file per link, and the filename is the link's permanent id:

```
content/links/<country>/<category>/<slug>.yaml
```

`<slug>` is kebab-case, derived from the title: `Berlin Flat Listings` → `berlin-flat-listings`. Choose it
carefully — it is the URL, and renaming a file breaks any link people have already shared.

Copy the closest existing file in the same category and edit it:

```
---
title: Berlin Flat Listings
url: https://berlinflatfinder.example
country: de
category: housing
description: >-
  Filterable Berlin flat listings by district and rent ceiling. Landlords list here directly, so the
  stock is current.
added_at: 2026-10-06
last_checked: null
description_verified: true
contributors:
  - your-github-handle
featured: false
tags:
  - free
---
```

`description_verified: true` is a claim that a person has read the description and the page it describes. If
you drafted the wording with an assistant, or you have not opened the URL yourself, drop the line — the
default is `false`, the site marks the entry as awaiting review, and a maintainer flips it after reading.

### 5. Write a description that earns its place

This is the field that gets read, and the one that gets rejected. It has to tell a reader something they
could not get from the title alone, and something they would not find without visiting the page.

| | |
| --- | --- |
| Rejected | "A comprehensive guide to finding an apartment in Berlin, including listings, advice, and tips." |
| Accepted | "Filterable Berlin flat listings by district and rent ceiling, the only site that shows the Anmeldung requirement per address. Landlords list here directly, so the stock is current." |

Two or three sentences. Written for someone who has not been there yet. Say what it is *bad* at if that is
knowable — honest beats promotional.

### 6. Validate

```
make validate
```

Errors to fix, in the order you will hit them:

- a field the schema does not know (the schema is strict; typos are errors, not warnings)
- `country` not matching the directory the file sits in
- an unknown `category`, `country`, `scope` or `role`
- a `url` that is not `https://`, carries tracking parameters, or duplicates another file
- `added_at` or `last_checked` in the future

The validator cannot judge whether your description is honest — `description_verified: true` is a promise to
the reviewer, not a check. Warnings are not optional in practice either: `not canonical — prefer <url>` means
paste the suggested URL back in.

### 7. Prove the URL is alive

```
make links-check
```

A link is dead only when it is provably gone. `2xx` is healthy, a redirect is flagged for review and never
rewritten automatically, and `403`/`429` mean "a bot was here", not "this page is gone". If a good link is
blocked by bot protection, add the host to `engine/lib/link-allowlist.yaml` — but only after you have opened
the URL in a browser and confirmed the page exists.

The same check runs in CI on every push to `main` and on every pull request (`.github/workflows/links.yml`):
dead links fail the build, and redirects and bot-walled hosts arrive as PR annotations on the file that holds
them.

### 8. Regenerate the derived Markdown

`README.md` and `docs/**` are build artifacts. Never hand-edit them; edit the YAML and regenerate:

```
make export
```

### 9. Run everything CI runs, then open the PR

```
make ci        # validate + export + check + test + links-check, in order
make site-check  # build the site: SEO contract, internal links, page invariants
```

Or the pieces, if you want them separately:

```
make check     # content valid + generated Markdown current
make test      # engine test suite
```

`make site-check` matters most if you touched `src/` or a registry: `astro build` regenerates the agent
artifacts (`corpus.json`, `llms.txt`, `llms-full.txt`) and enforces the SEO contract
(`engine/lib/seo-contract.ts`) — per-page title and description lengths, word-count floors, required
JSON-LD — and fails the build when any of it disagrees with `content/`. A new country page with a title
that is too short cannot merge, because CI runs this build on every push and pull request
(`.github/workflows/ci.yml`).

Then push a branch and open a pull request ([git workflow](#git-workflow)). One link per pull request: a
reviewer has to read the description, and a ten-link PR gets closed for being unreviewable.

## Field reference

The schema in `engine/lib/schema.ts` is the single source of truth. Everything here is what that file
enforces.

| Field | Required | Rule |
| --- | --- | --- |
| `title` | yes | 3–120 characters. The name a real person uses for the resource. |
| `url` | yes | `https://`, canonical form: no `www.`, no tracking params, no trailing slash, query params sorted. |
| `country` | yes | Registered country slug, and must equal the directory the file lives in. |
| `category` | yes | Registered category slug. |
| `description` | yes | 10–200 characters. This is the review gate. |
| `added_at` | yes | `YYYY-MM-DD`, the day you created the file. Never a future date. |
| `last_checked` | no | `null` until `make links-check-update` stamps it, or `YYYY-MM-DD` and never before `added_at`. |
| `description_verified` | no | Default `false`. `true` only when a human has read the description and the page it describes. The site marks unverified entries as awaiting review, and `make pool-promote-apply` refuses anything still `false`. |
| `scopes` | no | Every country the link is useful for, `country` included. Replaces copying a file five times. |
| `roles` | no | Role slugs from `content/roles/`. An empty list means "useful to everyone" — leave it out for general resources. |
| `contributors` | no | GitHub handles credited with this entry, without the `@`. |
| `featured` | no | Default `false`. Curated highlights, pinned to the top of a country page. |
| `tags` | no | Up to 8, each ≤24 chars, e.g. `free`, `eu-only`, `newsletter`, `german`. |

## Add a country

```
pnpm run add-country -- --code=pt --region=europe
```

`--region` is required and has no default: guessing it puts the country in the wrong part of the map and the
wrong sitemap group. Omit it and the command prints the plausible regions for that code. It writes
`content/countries/<code>.yaml` and re-checks the registry, so a typo cannot land unnoticed.

Pass the flags through `pnpm`, not `make`: `make add-country CODE=pt --region=europe` currently fails, because
GNU make consumes `--region=...` as its own option and forwards the bare `--` to the script as the country
code.

## Add a category or a role

Edit the registry directly, following an existing file:

```
content/categories/<slug>.yaml   # name, description (10–200), order (0–199, lower sorts first)
content/roles/<slug>.yaml        # name, description (10–200)
```

The filename is the slug. A category nobody uses shows up as a note in `make validate`, which is how a dead
navigation entry gets caught.

## Fix a dead or moved link

Re-check the whole corpus and stamp the files that come back healthy:

```
make links-check-update
```

If a URL has genuinely moved, update `url:` to the new canonical form and leave `added_at` alone — it is the
date the entry was created, not the date it was edited. If it is gone, delete the file; a directory that
keeps broken links stops being a directory.

## Content rules that get a PR closed

- A description that restates the title.
- Marketing copy, or a link to your own product written by your own team.
- A link to another list of links, unless it is genuinely the best one.
- The same URL twice under different spellings (`www.`, trailing slash, `utm_source`).
- Copying one file per country instead of using `scopes`.
- A `description_verified: true` on a description that was never read.
- A hand-edit to `README.md` or `docs/**` — those are generated, and `make check` fails on the diff.
- Anything committed from `.agents/`: the pool holds unvetted machine output and is gitignored for a reason.

## Git workflow

Fork [the project](https://github.com/marceloboeira/awesome-expat) and check out your copy.

```
git clone https://github.com/contributor/awesome-expat.git
cd awesome-expat
git remote add upstream https://github.com/marceloboeira/awesome-expat.git
```

Make sure your fork is up to date, then create a topic branch:

```
git checkout main
git pull upstream main
git checkout -b my-link-branch
```

Make sure git knows who you are, since `contributors:` comes from it:

```
git config --global user.name "Your Name"
git config --global user.email "contributor@example.com"
```

Commit, push, and open a pull request from your branch. A good commit message says what changed and why —
"Add Berlin Flat Listings to Germany housing" beats "update".

If you have been working on it for a while, rebase before review:

```
git fetch upstream
git rebase upstream/main
git push origin my-link-branch -f
```

## Be patient

It's likely that your change will not be merged first time, and that the nitpicky maintainers will ask you to
rework the description or fix a seemingly benign detail. Hang on there — that review is what keeps the
directory worth opening.

## Thank You

Please do know that we really appreciate and value your time and work. We love you, really.
