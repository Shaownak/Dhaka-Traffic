# Data

Four datasets, and the distinction between them is the point.

| Dataset | Status | Source | File |
|---|---|---|---|
| Published traffic figures | **Measured** | Named institutions | `src/data/traffic.ts` |
| Places to stop | **Measured** | OpenStreetMap | `src/data/measured/places.json` |
| The routable network | **Mixed** | Names and roads real, speeds modeled | `src/data/network.ts` |
| Journey times | **Empty** | Would be Google Routes | `src/data/measured/network-times.json` |

## 1. Published figures — measured

Transcribed as stated from named sources, each carrying a citation shown beside
it on the page. These may be presented as findings.

| Figure | Source |
|---|---|
| 7 km/h now, 21 km/h a decade earlier; 3.2m working hours lost a day | World Bank, presented July 2017 |
| 5m work hours lost a day; Tk 37,000 crore a year | BUET Accident Research Institute, 2018 |
| 6.5 km/h (2020), 4.8 km/h (2022) peak-hour speed | BUET, reported 2023 |
| Slowest of 1,200 cities in 152 countries | NBER city speed study, 2023 |
| Comfortable walking speed 0.94–1.43 m/s | Bohannon & Williams Andrews, 2011 |
| Metro Rail (MRT Line 6) commercial speed ~35 km/h | DMTCL, 2023 |

## 2. Places — measured

2,301 named, positioned eating places collected from OpenStreetMap via Overpass.

```bash
npm run collect:places
```

- **Licence:** ODbL 1.0. Attribution is required and the page carries it.
- **Committed to the repository**, because open licensing permits it — which is
  precisely why OSM was chosen over a commercial places API whose results
  generally cannot be cached or redistributed.
- 1,589 restaurants, 462 fast food, 250 cafes.

### What OSM does not carry

| Field | Coverage | Consequence |
|---|---|---|
| Ratings | **None at all** | Stops are never ranked "by quality" |
| Live availability | **None at all** | Nothing claims a table is free |
| Opening hours | ~16% | `unknown` is the normal case, not a defect |
| Cuisine | ~22% | A cuisine filter only matches stated tags |

The collector writes optional fields **only when the tag is present**. Nothing
downstream defaults them to something that reads like a measurement.

Loaded on demand (66 kB gzipped, its own chunk) so a reader who never asks for a
stop never pays for it.

## 3. The routable network — mixed

`src/data/network.ts`: 28 places, 39 roads.

- Place names, the connections between them, and approximate distances: **real**.
- `lat`/`lon`: placed by hand, **not verified against a survey**. Good enough to
  position a restaurant relative to a corridor; check every pair before spending
  on a collection run.
- `peakKmh` and `freeKmh`: **modeled**. Assigned to match the ordering these
  roads are reported to have. Plausible, not measured.

`npm run audit:network` reports what the graph can and cannot do: unreachable
pairs (0), pairs offering only one route (2, both genuine dead-end stubs), and
the deepest journey (8 hops).

## 4. Journey times — empty

`src/data/measured/network-times.json` currently holds `"roads": {}`.

This is why every estimate reports LOW confidence and the `baseline` tier. The
file is not a placeholder to be filled with something plausible; it stays empty
until real samples exist.

### The pipeline

```
collect-network-times.mjs  →  data/raw/network-times.ndjson   (append only)
build-network-times.mjs    →  src/data/measured/network-times.json
the planner                →  picks it up automatically
```

The last step needs no human action and no code change: the `profile` tier
activates the moment the file is non-empty. Verified with a synthetic run —
tier flipped, coverage 0% → 100%, confidence LOW → MEDIUM.

The builder writes, per road, per hour, per day type: the median, `p10`, `p90`,
and the **sample count**. With fewer than five samples in a cell the p10/p90 fall
back to the median rather than publish a spread the data cannot support.

### Schema

`data/raw/network-times.ndjson`, one JSON object per road per sample, append
only. Never rewrite history: filter a bad run at analysis time instead, so past
numbers cannot silently change.

| Field | Meaning |
|---|---|
| `collectedAt` | ISO 8601, UTC — the time it actually ran |
| `localHour` | 0–23 in Dhaka (UTC+6) |
| `dayType` | `working` or `weekend` |
| `road` | `"a\|b"`, matching `ROADS` |
| `minutes` | Observed journey time |
| `freeMinutes` | Same trip with no traffic |
| `meters` | Route distance |
| `error` | Present instead of the measures when a sample failed |

### Analysis notes

- **Friday and Saturday are the weekend in Bangladesh.** Averaging all seven days
  flattens the peaks that make this story.
- **Delay, not speed, is the quantity to report.** A slow corridor and a long
  corridor are not the same finding.
- **Median beats mean** per hour-of-day cell: one blocked evening should not drag
  an hour on its own.
- **Report a range.** Publish the spread alongside the value.
- **Ramadan, Eid and the monsoon** change traffic materially. Tag the collection
  window and say which it covers.

## Weather

Open-Meteo, keyless, CC BY 4.0. Fetched by the API and **displayed, never
applied** to any travel time. See `docs/TRAFFIC_MODEL.md` for why.

## Air quality

`scripts/collect-air-quality.mjs` samples OpenAQ v3 for Dhaka's PM2.5 monitors.

One caution, repeated from the script: traffic is one source of Dhaka's PM2.5,
not the dominant one. Brick kilns and construction dust are large and seasonal
contributors. Correlating a speed series against a PM2.5 series will produce a
number, and that number will not be causal.

## Rules

1. **Never commit synthetic data.** When testing a collection path, generate it,
   verify, and restore the empty file.
2. **A missing field stays missing.** Never default it to something that reads
   like a measurement.
3. **The tier travels with the number**, from `estimateLeg()` to the screen.
4. **Nothing calls a provider API from the page.** A static site has no server to
   hide a key behind, cost would scale with readers rather than with data, and a
   page whose numbers change between visits cannot be cited or fact-checked.
