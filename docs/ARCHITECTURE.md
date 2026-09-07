# Architecture

A modular monolith in TypeScript. One domain core, three things that call it:
the page, an HTTP API, and a handful of command-line scripts.

```
                 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
                 │  the page    │   │  HTTP API    │   │   scripts    │
                 │ src/sections │   │  server/     │   │  scripts/    │
                 └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
                        └──────────────────┼──────────────────┘
                                           ▼
                            ┌──────────────────────────────┐
                            │   src/core/journey/planner   │  the orchestrator
                            └──────────────┬───────────────┘
             ┌───────────────┬─────────────┼─────────────┬────────────────┐
             ▼               ▼             ▼             ▼                ▼
        geocoding/       routing/     optimization/    places/        traffic/
        resolve.ts       graph.ts     scoring.ts       provider.ts    hierarchy.ts
                                      stops.ts         opening-hours  confidence.ts
                                                                          │
                                           nl/parse.ts ──► nl/schema.ts   │
                                           weather/provider.ts            │
                                                                          ▼
                                                          src/data/  (all constants)
```

## The one rule

**The planner decides. Everything else presents.**

`planJourney()` is the only place a journey is chosen. The page does not re-rank
its results, the API does not second-guess them, and the explanation layer only
describes a decision that was already made. If the page and the API could each
decide, they would eventually decide differently, and there would be no way to
say which was right.

## Why TypeScript on both sides

The routing, scoring and stop-optimization logic already existed in TypeScript
and was well tested. A Python backend would have meant reimplementing all of it
and maintaining two engines that had to agree forever. The server imports the
same modules the browser does — Node strips the types at load time
(`scripts/lib/ts-loader.mjs`), so there is no build step and no second copy.

## Layers

| Directory | Holds | Knows about |
|---|---|---|
| `src/data/` | Every constant, weight and threshold | nothing |
| `src/core/geo.ts` | Distance, projection, position along a path | nothing |
| `src/core/traffic/` | Which source answers, and how much to trust it | data |
| `src/core/routing/` | The graph, Dijkstra, k-shortest-paths | data, traffic |
| `src/core/places/` | The OSM dataset, spatial index, opening hours | geo |
| `src/core/optimization/` | Scoring routes and stops, departure search | routing, places, traffic |
| `src/core/geocoding/` | Text to junction | data |
| `src/core/nl/` | Sentence to constraints, and the schema that gates it | geocoding, data |
| `src/core/weather/` | Forecast, reported and never applied | geo |
| `src/core/journey/` | The orchestrator and its types | all of the above |
| `src/sections/` | The page | core |
| `server/` | HTTP transport | core |

Dependencies point one way, downward. `src/core/` never imports from
`src/sections/`, and nothing in `src/core/` touches the DOM — a property the
server's `tsconfig.json` enforces mechanically by compiling the core without the
DOM library. If a core module ever reaches for `document`, `npm run typecheck`
fails.

## The planning pipeline

`planJourney(request)` runs, in order:

1. **Resolve** origin and destination against the network (`geocoding/resolve`).
2. **Resolve time** — a departure, or a deadline to work backwards from.
3. **Enumerate** genuinely different routes (Yen's k-shortest-paths).
4. **Cost** each leg at the hour it is actually driven, through the traffic
   hierarchy.
5. **Rank** against the reader's stated preference.
6. **Find stops**, if asked, ranked by how little they disrupt the journey.
7. **Attach** uncertainty and confidence to every option.
8. **Label** the alternatives by what they measurably are.
9. **Explain** the recommendation from the structured result alone.

Step 9 is a template over numbers settled in step 5. No language model
participates. See `docs/JOURNEY_OPTIMIZATION.md`.

## Where the language model is, and is not

The natural-language layer converts a sentence into a `JourneyIntent`: two place
names, some times, an optional stop. That intent passes through
`nl/schema.ts:validateIntent`, which rejects unknown fields rather than ignoring
them — so a model that invents `"trafficConditions": "heavy"` fails loudly.

The shipped parser is rules, not a model: deterministic, offline, free, and
incapable of naming a place that is not in the network. `parseWithLlm` is the
seam for a model, and it pushes the model's output through the same validator and
falls back to the rules on failure.

A model may read words. It may never supply a coordinate, a travel time, a
distance, or a route.

## What is deliberately absent

- **No database.** The data is a 28-node graph, a 2,300-row place list and an
  as-yet-empty times table. All of it fits in memory and loads in milliseconds.
  PostGIS earns its place when there is a spatial workload; there is not one yet.
- **No Redis.** A full plan takes ~5 ms. There is nothing worth caching.
- **No Docker.** `npm install && npm run dev` is the whole setup. A compose file
  would exist to orchestrate services that do not exist.
- **No microservices, no queue, no worker.** One process, one deployment.

These are not gaps to be filled on a schedule. Each becomes worth adding at a
specific, nameable point — see `docs/DEVELOPMENT.md`.
