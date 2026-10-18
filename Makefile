# Single entry point. Everything else is a detail of the engine.
#
# `make` with no target lists the targets. `make help` does too.
# All content commands go through pnpm so the node_modules/.bin PATH is correct.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# Targets that forward arguments do it with `make target NAME=value`, never
# `make target --name=value`. GNU make (including the 3.81 on macOS) parses an
# unknown leading `--name=value` as one of its OWN options and aborts with
# "unrecognized option" before any recipe runs; MAKEOVERRIDES does not prevent
# this, it only stops the assignment becoming a variable. So the dash form is
# not usable through make at all, and the scripts keep their `--name=value`
# parsing for direct `pnpm run` invocation.

PNPM ?= pnpm
PKG  = awesome-expat

# The single source of truth for phony targets. Add a target here once; there
# is no second list to keep in sync. `.PHONY` is declared from it below, and
# `check-phony` proves that every real target appears here.
PHONY_TARGETS := help setup dev build preview check export validate seed \
        links-check links-check-update site-check test i18n-report clean distclean \
        add-link add-country list status ci \
        stats stats-json \
        pool-status pool-harvest pool-dedup pool-verify pool-classify pool-describe \
        pool-promote pool-promote-apply pool-pipeline \
        check-phony

.PHONY: $(PHONY_TARGETS)

# PHONY_TARGETS above is the source of truth for the target list; `make help`
# renders it from the `## name:` comments. This check fails if a real target is
# missing from that list, which is what silently lets a same-named file shadow
# a target. Reading it from PHONY_TARGETS is the point: a second hand-maintained
# copy of the list is the bug it exists to prevent.
check-phony:
	@missing=$$(comm -23 \
		<(grep -E '^[a-z][a-z0-9-]*:' Makefile | sed -E 's/:.*//' | sort -u) \
		<(printf '%s\n' $(PHONY_TARGETS) | sort -u)); \
	if [ -n "$$missing" ]; then echo "targets missing from .PHONY: $$missing"; exit 1; fi

## help: List available targets
help:
	@echo "awesome-expat"
	@echo
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /' | sort
	@echo
	@echo "Quick start: make setup && make dev"

## setup: Install dependencies
setup:
	$(PNPM) install

## dev: Start the Astro dev server
dev:
	$(PNPM) run dev

## build: Validate, export Markdown, then build the static site
build: validate export
	$(PNPM) exec astro build

## preview: Serve the built site locally
preview:
	$(PNPM) run preview

## stats: Totals, per-category, per-country, per-role, coverage gaps.
stats:
	@$(PNPM) run stats

## stats-json: Same numbers as JSON, for diffing across runs.
stats-json:
	@$(PNPM) run stats -- --format=json --out=.agents/stats.json

# --- Local content pool (Ollama; quarantined under .agents/pool/) ---------
#
# Make target names use dashes, not colons. GNU Make 3.81 parses
# "pool:status:" as target 'pool' with a static-pattern prerequisite, so a
# colon in a target name is a hard parse error on the macOS system make.
# The pnpm scripts keep the colon form.
#
# Every target is dry-run by default. The pool can never reach content/
# except through pool-promote-apply, which refuses any candidate whose
# description_verified is still false.

## pool-status: Show pool candidates and their stage
pool-status:
	@$(PNPM) run pool:status

## pool-harvest: Pull candidate URLs into the pool
pool-harvest:
	@$(PNPM) run pool:harvest

## pool-dedup: Collapse duplicate candidates
pool-dedup:
	@$(PNPM) run pool:dedup

## pool-verify: Check each pool URL is alive
pool-verify:
	@$(PNPM) run pool:verify

## pool-classify: Assign country + category to pool candidates
pool-classify:
	@$(PNPM) run pool:classify

## pool-describe: Draft descriptions (always sets description_verified: false)
pool-describe:
	@$(PNPM) run pool:describe

## pool-promote: Dry-run of promoting pool candidates into content/
pool-promote:
	@$(PNPM) run pool:promote

## pool-promote-apply: The one target that lets agent output into content/. Always re-checks after.
pool-promote-apply:
	@$(PNPM) run pool:promote -- --apply
	@$(MAKE) --no-print-directory check

## pool-pipeline: Full pool pipeline, dry run end to end.
pool-pipeline:
	@$(MAKE) --no-print-directory pool-harvest
	@$(MAKE) --no-print-directory pool-dedup
	@$(MAKE) --no-print-directory pool-verify
	@$(MAKE) --no-print-directory pool-classify
	@$(MAKE) --no-print-directory pool-describe
	@$(MAKE) --no-print-directory pool-status

## check: Validate content and fail if generated Markdown is stale
#
# Generates into .agents/export-check/ and diffs, rather than regenerating in
# place. Regenerating first would overwrite a hand edit before noticing it,
# which is the mistake this target is supposed to catch.
check: validate
	@rm -rf .agents/export-check
	@EXPORT_DIR=.agents/export-check $(PNPM) run export >/dev/null
	@stale=$$(diff -rq README.md .agents/export-check/README.md >/dev/null 2>&1 || echo README.md); \
	for f in docs/index.md docs/jobs.md; do \
		diff -q "$$f" ".agents/export-check/$$f" >/dev/null 2>&1 || stale="$$stale $$f"; \
	done; \
	for f in docs/countries/*.md; do \
		[ -e "$$f" ] || continue; \
		diff -q "$$f" ".agents/export-check/$$f" >/dev/null 2>&1 || stale="$$stale $$f"; \
	done; \
	for f in .agents/export-check/docs/countries/*.md; do \
		[ -e "$$f" ] || continue; \
		[ -e "docs/countries/$$(basename $$f)" ] || stale="$$stale docs/countries/$$(basename $$f) (missing)"; \
	done; \
	rm -rf .agents/export-check; \
	if [ -n "$$stale" ]; then \
		echo "generated Markdown is out of date:"; \
		for f in $$stale; do echo "  $$f"; done; \
		echo; \
		echo "If you edited these by hand, that is the bug this target exists to catch."; \
		echo "Edit content/ and run 'make export' instead."; \
		exit 1; \
	fi
	@echo "check: content valid, generated Markdown current"

## validate: Validate every YAML file and cross-reference
validate:
	@$(PNPM) run validate

## export: Regenerate README.md and docs/ from content/
export:
	@$(PNPM) run export

## seed: Write the country/category/group/role registries (idempotent)
seed:
	@$(PNPM) run seed

## links-check: Check every link, failing on dead ones
links-check:
	@$(PNPM) run check-links

## site-check: Check the built site (requires build; internal links + invariants)
#
# `make links-check` validates the external URLs in content/. This validates
# the other direction: the internal links between generated pages, and
# the claims each page makes about itself. Both are build-time mistakes that
# `astro build` reports as success.
#
# Built output first, then the two checks that read it. `rm -rf` matters: a
# stale dist/ from a previous build would be checked as if it were current.
site-check:
	@rm -rf dist .astro
	@$(PNPM) exec astro build >/dev/null
	@$(PNPM) exec tsx ./engine/test/internal-links.ts
	@$(PNPM) exec tsx ./engine/test/site-invariants.ts

## links-check-update: Check links and stamp last_checked on healthy files
links-check-update:
	@$(PNPM) run check-links -- --update

## test: Run the engine test suite
test:
	@$(PNPM) exec tsx ./engine/test/bin/run.ts

## ci: Everything CI runs, in order. Run this before opening a PR.
#
# The full gate as a single command. Each step already stops the build on
# failure, so this is just the ordered sequence a reviewer expects. `links-check`
# is read-only (it does not stamp files); use `make links-check-update` when you
# deliberately want to record that links are healthy.
ci: validate export check test links-check
	@echo "ci: all checks passed"

## i18n-report: Show which content needs translating
i18n-report:
	@$(PNPM) run i18n-report

## list: Show content counts and countries that have resources
list:
	@$(PNPM) run list

## add-link: Scaffold a new link file
#
#   make add-link URL=https://example.com COUNTRY=de CATEGORY=housing \
#     DESCRIPTION="What it is actually good for."
#
# Runs add-link.ts, which reads --url/--country/--category/--description; the
# Make variables are translated here.
#
# Only these four, deliberately. Make cannot forward arbitrary `--flag=value`
# (it rejects them as its own options), and a `$(ARGS)` escape hatch does not
# help: unquoted it word-splits, so `--title=Find a flat` silently becomes
# `--title=Find`. Anything beyond the four below goes through the script:
#   pnpm run add-link -- --url=... --country=... --category=... \
#     --description=... --title=... --roles=... --scopes=... --draft
add-link:
	@$(PNPM) run add-link -- --url='$(URL)' --country='$(COUNTRY)' \
		--category='$(CATEGORY)' $(if $(DESCRIPTION),--description='$(DESCRIPTION)',)

## add-country: Register a country
#
#   make add-country CODE=pt REGION=europe
add-country:
	@$(PNPM) run add-country -- --code='$(CODE)' --region='$(REGION)'

## status: Print the local agent plan status if it exists
status:
	@if [ -f .agents/plans/awesome-expat-portal/status.md ]; then \
		sed -n '/^## Phases/,/^## Decisions/p' .agents/plans/awesome-expat-portal/status.md; \
	else \
		echo "no local plan status yet"; \
	fi

## clean: Remove build output
clean:
	rm -rf dist .astro

## distclean: clean + remove installed dependencies
distclean: clean
	rm -rf node_modules
