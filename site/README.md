# Ektos site

The project's showcase site: what Ektos is, what it adds, what was measured and how far it can
be trusted. English by default, Turkish with the flag switch. Next.js 16 (App Router), three.js
for the opening globe, SQLite (Node's built-in `node:sqlite`) for what visitors leave.

The comparator itself is not part of this site: it is the static tool in `../web/`, served by
the Python engine. The site links to it, embeds its plate (`?embed=1`) and passes coordinate
requests to the engine through its own API.

## Run

Node 22.13 or newer, pnpm.

```bash
cp .env.example .env.local      # then set ADMIN_TOKEN and EXPERIMENT_KEY to long random strings
pnpm install
pnpm dev                        # http://localhost:3000
```

In a second terminal, for the embedded comparator, the coordinate demo and the live counters:

```bash
cd .. && .venv/bin/python -m ektos.server      # http://127.0.0.1:8765
```

Without the engine the site still works: the plate becomes a screenshot, the coordinate demo
says the engine is offline and shows the recorded Luhman 16 run, and the counters show dashes.

`pnpm build` and `pnpm start` for production. `pnpm lint`, `pnpm typecheck`.

## GitHub Pages

The same site also builds as plain static files, with the comparator next to it:

```bash
EKTOS_BASE_PATH=/ektos pnpm build:pages      # writes out/
```

`out/` holds the site under `en/` and `tr/`, the comparator (`../web/`, copied whole) under
`tool/`, a root page that sends visitors to their last language, and a `404.html`.
`.github/workflows/pages.yml` runs this on every push to the `website` branch and publishes
`out/`; in the repository settings, Pages must use "GitHub Actions" as its source.

Files ending in `.server.ts` or `.server.tsx` (the API routes, the team area and `proxy`) are
left out of this build, because a static host cannot run them. What changes on the static copy:

| Part | With the server | On GitHub Pages |
|---|---|---|
| Coordinate demo | Counts and fetches through the engine | Checks the packaged fields only, then opens the comparator |
| Counters | Live from the engine and the database | Packaged field counts from the repository |
| Experiment | Summary and upload | Upload is off |
| Contact | Form stored in SQLite | Link to a new GitHub issue |
| Comparator | `NEXT_PUBLIC_TOOL_URL` | `tool/` on the same site; new positions need a local engine |

## Where things are

| Path | What |
|---|---|
| `content/facts.ts` | Every measured number on the site, in one place. Edit here when the README changes. |
| `content/en.ts`, `content/tr.ts` | All text. `tr.ts` must have the same shape as `en.ts`; the build fails otherwise. |
| `app/[lang]/` | Pages: overview, science, experiment, contact, team area (`/en/admin`). |
| `app/api/engine/*` | Count, build and status, passed to the Python engine after validation and rate limits. |
| `app/api/stats` | Live counters: engine meter, packaged fields, stored sessions. |
| `app/api/contact` | Stores a message (no email is sent). |
| `app/api/experiment/*` | Upload the comparator's experiment records (team key), and their summary with 95% Wilson intervals. |
| `lib/db.ts` | The only file that touches SQL. |
| `scripts/sync-assets.mjs` | Copies images, the slides PDF, fonts and the all-sky map from the repo into `public/` before `dev` and `build`; nothing is kept twice in git. |
| `scripts/pages.mjs` | The GitHub Pages build: static export, the comparator under `tool/`, root and 404 pages. |
| `proxy.server.ts` | Sends `/` to `/en`, or to the language the visitor last chose. |

## Environment

| Variable | Meaning |
|---|---|
| `ENGINE_URL` | Where the site's server reaches the Python engine. |
| `NEXT_PUBLIC_TOOL_URL` | Where a visitor's browser reaches the comparator. |
| `DATABASE_PATH` | SQLite file, default `.data/ektos.db`. |
| `ADMIN_TOKEN` | Team area sign-in. Empty switches the team area off. |
| `EXPERIMENT_KEY` | Needed to upload experiment records. Empty switches uploads off. |
| `EKTOS_BASE_PATH` | `build:pages` only: the path the site is served under, `/ektos` for `https://<user>.github.io/ektos/`. The workflow takes it from GitHub. |

Rate limits are kept in memory, per process: enough for one machine next to the engine. A
hosted deployment with several instances would need a shared store.
