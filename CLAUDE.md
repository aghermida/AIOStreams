# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AIOStreams is a Stremio "super-addon" that aggregates results from many upstream Stremio addons + debrid/usenet services, then deduplicates, filters, sorts, formats and (optionally) proxies the streams before returning them to Stremio. It is a single-process Node service that also serves a React SPA configuration UI.

Requires Node `>=24` and pnpm `>=11` (enforced in root `package.json` engines).

## Commands

All commands run from the repo root. The repo is a pnpm workspace with packages under `packages/*`.

- `pnpm install` — install everything (pnpm workspaces).
- `pnpm build` — build `core` → `server` → `frontend` → `seanime-extensions` in that order (the order matters; later packages depend on `@aiostreams/core`).
- `pnpm dev` — run `core`, `server` and `frontend` in parallel watch mode.
- `pnpm start:dev` — `tsx watch` of `packages/server/src/server.ts` with `NODE_ENV=development` (use this when you only need the backend to reload).
- `pnpm start` — run the built server (`node packages/server/dist/server`). Requires `pnpm build` first.
- `pnpm start:frontend:dev` — only the rsbuild dev server for the SPA.
- `pnpm test` — run vitest in every workspace (`vitest run --passWithNoTests`).
- Per-package: `pnpm -F core test`, `pnpm -F frontend typecheck`, `pnpm -F frontend lint`, etc.
- Single test file: `pnpm -F <pkg> exec vitest run path/to/file.test.ts` (or add `-t "<name>"` for a single test).
- `pnpm format` — Prettier across all `*.ts`/`*.tsx`.
- `pnpm gen:env-docs` — regenerate env-var documentation from the config schema (run after changing `packages/core/src/config/schema`).
- `pnpm metadata` — regenerate addon metadata (`scripts/generateMetadata.cjs`).
- Docs site: `pnpm docs:dev` / `pnpm docs:build`.

The frontend uses rsbuild (not Vite/webpack directly) — `pnpm -F frontend dev` / `build` / `preview`.

## Architecture

### Workspace layout

- `packages/core` — the engine. Everything addon-related, all I/O, DB, cache, config, presets, builtins, stream pipeline. Other packages depend on it as `@aiostreams/core`.
- `packages/server` — thin Express 5 app that wires `core` to HTTP. Owns routing, middleware, rate limiting, static asset serving, and the server lifecycle.
- `packages/frontend` — React 19 SPA (rsbuild + TanStack Router + TanStack Query + Tailwind + Radix). Built output is served by the server from `packages/frontend/dist` at runtime.
- `packages/seanime-extensions` — separate Seanime extension bundles, built independently.
- `packages/docs` — the docs site (separate build).

### Request flow

1. `packages/server/src/server.ts` boots: initialises DB → templates → Redis (if configured) → AnimeDatabase / SeaDex / Prowlarr preconfigured indexers → registers scheduled `TaskManager` jobs (user pruning, cache eviction) → starts analytics → `app.listen`.
2. `packages/server/src/app.ts` mounts routers:
   - `/api/v{API_VERSION}/*` — JSON API consumed by the SPA (`user`, `health`, `status`, `format`, `catalogs`, `posters`, `oauth/exchange/gdrive`, `debrid`, `search`, `anime`, `proxy`, `templates`, `sync`, `auth`, `dashboard`). 404 handler is scoped to the API router.
   - `/stremio/...` — Stremio protocol endpoints. Public manifest/stream/configure routes are mounted directly; authenticated routes live under `/stremio/:uuid/:encryptedPassword` and go through `userDataMiddleware`, which resolves the `UserData` for the rest of the pipeline.
   - `/chilllink/:uuid/:encryptedPassword/*`, `/seanime/*`, `/builtins/*` (the last gated by `internalMiddleware`).
   - Legacy `/:config/stream/...` returns a single "reconfigure" stream pointing at the new configure URL. Legacy `/configure` redirects to `/stremio/configure`.
   - Static: `/assets/*` is content-hashed and served with `immutable` cache headers and bypasses the static rate limiter; `/logo.png`, favicons, manifest icons go through `staticRateLimiter`; SPA fallback serves `index.html`.
3. Stream requests construct an `AIOStreams` instance (`packages/core/src/main/index.ts`) from the resolved `UserData`. The constructor wires a pipeline of singletons: `Proxifier`, `StreamLimiter`, `StreamFilterer`, `StreamPrecomputer`, `StreamFetcher`, `StreamDeduplicator`, `StreamSorter`. The `setup.ts` helpers (`applyPresets`, `assignPublicIps`, `fetchManifests`, `buildResources`) turn the user's preset selections into concrete `Addon` instances and resolved manifests; `resources.ts` / `catalog.ts` implement the actual `getStreams` / `getCatalog` / `getMeta` / `getSubtitles` / `getAddonCatalog` calls.

### Presets vs builtins

- **Presets** (`packages/core/src/presets/*.ts`, ~80 files, registered in `presetManager.ts`) describe how to configure and call an external Stremio addon (Torrentio, Comet, MediaFusion, Easynews, etc.). Each preset extends a common `Preset` base in `preset.ts` and exposes configuration metadata consumed by the SPA. When adding a new community addon, add a preset file and register it in `presetManager.ts`.
- **Builtins** (`packages/core/src/builtins/*`) are addon implementations hosted in-process (gdrive, knaben, prowlarr, torznab/newznab, eztv, torrent-galaxy, seadex, easynews-search, library, …). They are exposed under `/builtins/<name>` via routes in `packages/server/src/routes/builtins`, and the `internalMiddleware` enforces that they are only called by the engine itself.

### Configuration

- `packages/core/src/config` owns all runtime configuration. `bootstrap.ts` reads env vars via `envalid`; `schema/` defines the user-data shape with zod; `describe.ts` produces metadata for the SPA and for `pnpm gen:env-docs`. After changing any env var or user-data schema, run `pnpm gen:env-docs` and rebuild.
- Per-user configuration is persisted via `packages/core/src/db` (repositories + migrations). The DB layer abstracts SQLite (`better-sqlite3`) and Postgres (`pg`) behind a shared driver — pick by setting the `DATABASE_URI` env var.
- Caching has three backends behind one `Cache` API: in-memory, SQL (rows in the configured DB), and Redis (if `REDIS_URI` is set). The cache clearing tasks in `server.ts` reflect this.

### Frontend

- Routing: TanStack Router with file-based routes in `packages/frontend/src/routes`. The `router.tsx` wires it up.
- Data: TanStack Query against `/api/v{N}/...`. The SPA never talks to `/stremio/*` directly.
- UI: Tailwind 3 + Radix primitives + `class-variance-authority` for variants; `framer-motion`/`motion` for animation.

### Release flow

- `release-please-config.json` drives release-please (conventional commits → version bumps → changelog). `pnpm release` (commit-and-tag-version) is the local equivalent. The CI workflow `.github/workflows/deploy-docker.yml` builds and publishes the Docker image.

## Conventions

- ES modules everywhere (`"type": "module"`). Relative imports inside a package must include the `.js` extension (TypeScript NodeNext resolution) — e.g. `from '../db/index.js'` even though the source is `.ts`.
- Cross-package imports use the workspace name: `from '@aiostreams/core'`.
- Logger: `createLogger('<scope>')` from `@aiostreams/core` (Pino under the hood); do not `console.log`.
- Errors that prevent startup should be thrown as `ConfigStartupError` — `server.ts` prints those without a stack trace.

## Fork sync conventions (read before touching `.github/workflows/` or deleting/renaming any file)

This repo is a personal fork of [`Viren070/AIOStreams`](https://github.com/Viren070/AIOStreams). `.github/workflows/docker.yml` merges `upstream/main` into `main` every night (cron), on every push, and on manual dispatch, then pushes the result and builds/publishes the Docker image. For this automation to keep working with **zero manual intervention**, the merge must apply cleanly every time — it only ever fails when a fork-only change touches something upstream is still actively evolving on its own.

The sister repo `aiometadata` (same fork-of-upstream setup) hit exactly this: it had deleted two CI workflow files upstream kept modifying, so every nightly sync produced a `modify/delete` conflict and failed repeatedly (2026-08-19 to 2026-08-21, fixed in PR #12 there). Follow these rules here too, for any file:

1. **Never delete, rename, or replace a file that still exists upstream** without registering it. If a file must genuinely diverge (this fork replaces upstream's version outright), add a `FORK_DELETED_UPSTREAM_FILES` array at the top of the "Sync fork with upstream" step in `docker.yml` (following `aiometadata`'s `docker.yml` as the reference implementation) listing its path with a one-line reason, and skip it explicitly during conflict resolution instead of just deleting it and hoping.
2. **Prefer new, uniquely-named files/directories for fork-only functionality** (e.g. a new preset file under `packages/core/src/presets/`, a new builtin under `packages/core/src/builtins/`). Upstream will never create a file with that name, so there is no collision surface, ever — this is always safer than rule 1.
3. **When a fork-only feature must live inside a file upstream also owns**, change it additively: new branches/cases, new optional config fields, new exports — don't delete or restructure the surrounding code upstream still maintains. Git's line-based merge only conflicts where both sides touch the *same* lines, so additive edits keep merging cleanly even as upstream keeps changing the file around them.
4. Treat everything under `.github/workflows/` as upstream-owned by default — assume upstream will keep editing any workflow file it ships, and apply rule 1 there specifically.
5. When merging a PR that contains a `Merge upstream/main into main` commit (or otherwise carries upstream's history), always use a real merge commit — **never squash**. Squashing breaks the shared history with upstream and causes the *next* nightly sync to fail for an unrelated reason (a fresh merge-base mismatch).
6. When `docker.yml`'s sync step fails with a real `CONFLICT (content)`, resolve it by hand in a PR (never push a resolution straight to `main`): fetch `upstream/main`, merge it into a branch, and for each conflicted file keep both sides' changes (per rule 3) rather than picking one. **After resolving, typecheck every touched package (`pnpm -F core exec tsc --noEmit -p .`, same for `server`/`frontend`) before pushing** — git's line-based merge can silently drop one side's addition with no conflict marker at all when it sits right next to a hunk the other side touched, which `git diff`/`grep` for `<<<<<<<` won't catch but `tsc` immediately flags as `Cannot find name`. Verify *whose* addition it actually was before restoring it, though: PR #30 first "fixed" exactly this in `packages/frontend/src/lib/api.ts` by restoring a `FormatStreamResponse` interface and `getFormattedStream()` export, assuming they were fork-only and had been silently dropped — they were actually upstream's own (Viren070, Feb 2026), which upstream itself deleted in the same sync as part of a legitimate refactor (the formatter preview moved to client-side rendering via `lib/formatter-render.ts`). `git log --follow -S<symbol>` and checking the author before restoring anything would have caught this.
7. **IMPERATIVE — no exceptions:** whenever rule 3 applies (a fork-only entry must live inside a shared list — an import block, a barrel `export *` list, a registration array, a `switch`/`case`, an object literal used as a lookup table), the entry MUST be appended after the *last* existing item. Never insert it in the middle, never interleave it alphabetically or thematically with upstream's own entries, even when that looks tidier. This applies to every current and future fork-only addition without exception — there is no case where interspersing is an acceptable tradeoff for readability. Two purely-additive insertions at different points in the same list still conflict if they land close enough together (adjacent lines, or a line upstream reorders/edits); appending after everything upstream currently has minimizes how often that happens, and if upstream also only ever appends at the tail, concurrent tail-appends from both sides typically merge cleanly with no conflict at all. This generalizes the 9000+ migration id range to non-numeric lists — see `packages/core/src/presets/presetManager.ts` (Nextcloud's import, `PRESET_LIST` entry, and `switch` case are all last) for a worked example. Before adding any fork-only entry to any shared list, check its current last position first.

### Repository Settings → Actions

Two repo-level settings (Settings → Actions → General), inherited from GitHub's restrictive defaults on fork/new repos, gate workflows that are otherwise correct and match upstream byte-for-byte:

- **Actions permissions** must be "Allow `aghermida`, and select non-`aghermida`, actions and reusable workflows" with `docker/*,pnpm/*` added to the allow-list (on top of the built-in "Allow actions created by GitHub" checkbox) — `docker.yml` and `build.yml` use `docker/login-action`, `docker/build-push-action`, `docker/setup-buildx-action`; `update-header-presets.yml`/`docs.yml` use `pnpm/action-setup`. Without this, those steps get silently skipped/blocked.
- **"Allow GitHub Actions to create and approve pull requests"** (same page) must stay enabled — `update-header-presets.yml` (upstream-authored, identical in this fork) opens a PR via `gh pr create` when it detects a version bump. With the setting off, the step fails with `GraphQL: GitHub Actions is not permitted to create or approve pull requests (createPullRequest)`. This can go unnoticed for a while: the workflow only reaches that code path on a week where a header preset version actually changed, so an earlier run can report green while never having exercised PR creation.
