# Seven Kilometers an Hour

A visual data story about traffic congestion in Dhaka, and a journey optimizer
built on the same engine.

The story explains why the city moves at seven kilometers an hour. The planner
answers what to do about it: *"I want to leave Gulshan at 5 PM, stop at a
restaurant roughly halfway, and reach Mirpur before 8."*

## Running it

```bash
npm install
```

```bash
npm run dev
```

Node 22 or newer. No database, no Redis, no Docker — see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for why, and
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for when each becomes worth adding.

Plan a journey without a browser:

```bash
npm run journey -- --ask "leave Gulshan at 5 PM, eat halfway, reach Mirpur by 8"
```

Or run the HTTP API:

```bash
npm run api
```

## What the planner does

Given where you are going, when, and whether you want to stop, it:

- resolves both ends against a 28-junction network
- enumerates genuinely different routes (Yen's k-shortest-paths)
- costs every leg **at the hour it is actually driven**, not the departure hour
- ranks them against a stated preference — fastest, most reliable, least traffic
- finds somewhere to stop, ranked by how little it disrupts the journey
- works backwards from a deadline when you give one
- reports an arrival **range**, never a single number
- explains the recommendation from the structured result alone

Both input modes — the form and the sentence box — build the same request and
call the same `planJourney()`. So does the API. There is one engine.

## The honesty machinery

This is the part worth reading the code for.

**Every travel time carries the tier that produced it**, from `estimateLeg()` all
the way to the sentence on screen:

```
observed   a recent measurement          — needs a live feed        (unavailable)
profile    a statistic over samples      — needs collection         (unavailable)
predicted  a fitted model                — needs the above first    (unavailable)
baseline   modeled speeds, shaped by hour                           ← in use
freeflow   the road with no traffic                                 ← last resort
```

**As shipped, no journey times have been collected.** Every estimate resolves to
the modeled baseline, every plan reports LOW confidence, and the page says so.
The unavailable tiers return `null` rather than falling through to something
similar and being labelled as though they had answered.

The `profile` tier activates by itself the moment a collection run writes a
non-empty file — no code change. Verified: tier flips, coverage goes 0% → 100%,
confidence rises LOW → MEDIUM.

Elsewhere the same discipline:

- **Weather is fetched and displayed, never applied.** No measured rain-versus-dry
  series exists, so a multiplier would be inventing the finding.
- **Stops are never ranked by quality.** OpenStreetMap carries no ratings, so
  there is no quality term at all — only journey disruption, which we compute.
- **Opening hours return `unknown`, never a guess.** About one place in six states
  them; anything the parser cannot read stays unknown rather than becoming "open".
- **A language model may read words and never supply numbers.** The intent schema
  rejects unknown fields, so a model inventing `"trafficConditions"` fails loudly.

## Layout

```
index.html                 the markup
src/
  main.ts                  entry, section observers, boot order
  util.ts                  congestion scale, reduced-motion, observers
  data/                    ALL constants: figures, network, tuning weights
    traffic.ts             the story's numbers and every citation
    network.ts             28 junctions, 39 roads
    intelligence.ts        scoring weights and thresholds
    measured/              collected data: places, journey times
  core/                    the domain — no DOM anywhere
    geo.ts                 distance, projection, position along a path
    geocoding/             text to junction
    routing/               time-dependent Dijkstra, Yen's k-shortest-paths
    traffic/               the source hierarchy, and confidence in it
    places/                the OSM dataset, spatial index, opening hours
    optimization/          scoring routes, stops, departure search
    nl/                    sentence to constraints, and the schema that gates it
    weather/               forecast, reported and never applied
    journey/               THE orchestrator, and its types
  sections/                the story sections
    street/                the Three.js simulation
    trip/                  the planner UI
      index.ts             controller: DOM wiring only
      state.ts             the request being built, and what is on screen
      results.ts           timeline, departure advice, curve, option cards
      map.ts               the route schematic
      format.ts            shared formatting
  styles/
    tokens.css             colour, type scale, spacing
    base.css
    buttons.css            one button system, every section
    sections.css           an index: imports story/ in page order
    story/                 one file per section of the page
    planner.css            the planner's own surface
server/                    HTTP transport over the same core
scripts/
  collect/                 pull data from providers
  build/                   turn raw samples into what the app reads
  dev/                     CLI planner, network audit, sampling economics
  lib/                     the loader that lets Node import the TS source
docs/
```

## Documentation

| | |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, the one rule, what is deliberately absent |
| [DATA.md](docs/DATA.md) | Four datasets, what each is worth, the schemas |
| [TRAFFIC_MODEL.md](docs/TRAFFIC_MODEL.md) | The tier hierarchy, uncertainty, why no ML yet |
| [JOURNEY_OPTIMIZATION.md](docs/JOURNEY_OPTIMIZATION.md) | Routing, stop ranking, departure search |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Commands, the API, environment, testing |

## The story sections

The scrollytelling page is unchanged and still the front half of the project:
a 2D canvas traffic field, a car-versus-pedestrian-versus-Metro race, the sourced
speed record, a radial 24-hour clock, a corridor map, a Three.js street
simulation, the annual cost, a policy simulator, and the provenance ledger.

The simulation is a model, not an animation: each vehicle picks its speed from
the gap ahead — `want = min(vmax, (gap - minGap) / headway)` — clamped by
acceleration and braking limits, with an occasional random brake tap that seeds
stop-start waves. The queues are emergent.

## Testing

```bash
npm test
```

192 tests. The acceptance tests in `src/core/journey/planner.test.ts` run the
whole orchestrator against the real network and the real places dataset,
including the full scenario: Gulshan → Mirpur, 5 PM, restaurant halfway,
deterministic down to which restaurant.

## Deploying

`npm run build` writes a fully static `dist/`. The page needs no server and calls
no API at runtime. The journey planner runs entirely in the browser — a full plan
takes about 5 ms.

`server/api.ts` is optional, for consumers other than the page.
