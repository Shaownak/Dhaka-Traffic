# Development

## Setup

Node 22 or newer (the scripts and the API rely on Node's built-in TypeScript
type-stripping, and on `import` attributes).

```bash
npm install
```

There is no database, no Redis and no Docker to start. That is deliberate — see
"When to add infrastructure" below.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | The page, on Vite's dev server |
| `npm run build` | Static build into `dist/` |
| `npm run preview` | Serve the built output |
| `npm run api` | The HTTP API on port 8787 |
| `npm run typecheck` | Both projects: browser and server |
| `npm test` | The full suite |
| `npm run journey` | Plan a journey from the command line |
| `npm run audit:network` | Report gaps in the routable graph |
| `npm run collect:places` | Refresh the OSM places dataset |
| `npm run collect:times` | Sample journey times (needs a key) |
| `npm run build:times` | Turn samples into hourly profiles |
| `npm run plan:sampling` | Sampling economics for collection |

`npm run typecheck` runs `tsc` twice: once for the browser (DOM, no Node) and
once for the server (Node, no DOM). The split is load-bearing — it is what
mechanically prevents a core module from reaching for `document`.

## Trying it without a browser

```bash
npm run journey -- --from gulshan --to mirpur --at 17:00 --stop any
```

```bash
npm run journey -- --ask "leave Gulshan at 5 PM, eat halfway, reach Mirpur by 8"
```

Same orchestrator the page and the API use, so what it prints is what they would
answer.

## The API

```bash
npm run api
```

```bash
curl -s -X POST http://localhost:8787/api/journey/plan -H 'Content-Type: application/json' -d '{"text":"leave Gulshan at 5 PM, eat halfway, reach Mirpur by 8 PM"}'
```

| Endpoint | |
|---|---|
| `GET /api/health` | Liveness |
| `GET /api/system/status` | What is loaded, which traffic tiers can answer |
| `GET /api/geocode?q=` | Resolve a name to a junction |
| `GET /api/places` | The network's junctions |
| `GET /api/places/search?lat=&lon=&radiusKm=&kind=` | POI search |
| `POST /api/routes` | Raw routes, no scoring |
| `POST /api/journey/plan` | The main endpoint |
| `POST /api/journey/optimize` | As above, requires `arriveBy` |
| `POST /api/journey/parse` | Sentence to structured intent |
| `GET /api/traffic/forecast?from=&to=` | Hourly journey time |
| `GET /api/traffic/segment/gulshan\|badda` | One road, hour by hour |
| `GET /api/weather?lat=&lon=` | Forecast (never applied to travel times) |

Errors return `{ error: { code, message } }`. Stack traces are logged, never
returned.

## Environment variables

Copy `.env.example`. Nothing is required to run the page or the API.

| Variable | Needed for | Notes |
|---|---|---|
| `GOOGLE_ROUTES_KEY` | `collect:times`, `collect:corridors` | Billed per request. **Set a daily quota cap before the first real run.** |
| `OPENAQ_KEY` | `collect-air-quality.mjs` | Free |
| `PORT` | The API | Defaults to 8787 |

Keys are read from `process.env` only. They are never hardcoded, never committed,
and **never exposed to the frontend** — a static page has no server to hide a key
behind, so all provider calls happen in offline collectors or the API process.

Open-Meteo and Overpass need no key.

## Testing

```bash
npm test
```

192 tests. The ones that matter most are in
`src/core/journey/planner.test.ts`: they run the whole orchestrator against the
real network and the real places dataset, and check the answers a traveller would
read — including the full acceptance scenario (Gulshan → Mirpur, 5 PM, restaurant
halfway).

Every test is deterministic. The engine takes a date and a time as inputs rather
than reading the clock.

### A lesson worth keeping

Two tests originally asserted "the tier is always `baseline`" and "confidence is
always LOW". Both passed — but only because nothing had been collected yet, and
both would have failed the first time somebody ran the collector, which is
exactly when they most needed to keep working. They now assert the *relationship*
between what is on disk and what the plan claims. Prefer that shape.

## When to add infrastructure

Nothing here is a gap on a schedule. Each becomes worth adding at a nameable
point:

| Add | When |
|---|---|
| PostgreSQL + PostGIS | The observations table outgrows a file — roughly a million rows, or when arbitrary time-range queries are needed. A year of collection at 936 requests/day is ~340k rows, so not immediately. |
| Redis | Plans stop being ~5 ms. Today there is nothing worth caching. |
| Docker | There is a second service to orchestrate. One process needs no compose file. |
| A real routing engine (OSRM) | Doorway-level routing is needed, or true road geometry. `RoutingProvider` exists so this is a new implementation, not a rewrite. |
| A trained model | The `profile` tier has 30+ samples per cell and a candidate beats the historical baseline on held-out days. |

## Conventions

- All constants live in `src/data/`. No magic numbers in algorithms.
- Node's type-stripping does not support constructor parameter properties or
  enums. Declare and assign fields explicitly.
- Imports are extensionless (bundler style); `scripts/lib/ts-loader.mjs` bridges
  that and JSON import attributes for raw Node.
- Never commit synthetic data. When testing the collection path, generate it,
  verify, and restore the empty file.
