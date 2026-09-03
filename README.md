# Seven Kilometers an Hour

A visual data story about traffic congestion in Dhaka. One page, no navigation,
no framework: Vite and vanilla TypeScript, D3 submodules for the 2D charts, and
a code-split Three.js scene for the street simulation.

`reference/prototype.html` is the approved single-file prototype.

## Running it

```bash
npm install
```

```bash
npm run dev
```

`npm run build`, `npm run preview`, `npm run typecheck` and `npm run test` do
what they say. Node 18 or newer.

## Layout

```
index.html                 the markup
src/
  main.ts                  entry, section observers, boot order
  util.ts                  the congestion scale, reduced-motion flag, observers
  data/traffic.ts          ALL numbers and ALL citations live here
  sections/
    jam.ts                 cover: 2D canvas traffic field
    race.ts                car vs pedestrian vs Metro Rail (MRT Line 6), SVG
    history.ts             the sourced speed record, SVG, hover + keyboard
    clock.ts               radial 24-hour clock, SVG, hover + data table
    map.ts                 corridor map with MRT Line 6 overlay, SVG, hover + keyboard
    street/
      index.ts             section wiring, controls, lazy Three import
      scene.ts             geometry, lights, sky-by-hour, camera presets, monsoon rain
      traffic-model.ts     car-following simulation with Dhaka vehicle fleet, no Three imports
      traffic-model.test.ts
    cost.ts                year grid + corridor picker + personal commute calculator
    solutions.ts           interactive transit & urban policy simulator
    sources.ts             provenance chips, city facts, citation list
    night.ts               closing ring
  styles/                  tokens.css, base.css, sections.css
public/                    fonts, favicon.svg, robots.txt
```

## Two kinds of numbers, never mixed

`src/data/traffic.ts` holds both, and the distinction is load-bearing:

**Sourced.** Carries a `source` id into the `SOURCES` record, and every place it
appears on the page shows a chip linking to the citation. These may be presented
as findings.

| Figure | Source |
|---|---|
| 7 km/h now, 21 km/h a decade earlier; 3.2m working hours lost a day; 4 km/h projected for 2035 | World Bank figures presented in July 2017 |
| 5m work hours lost a day; Tk 37,000 crore a year | BUET Accident Research Institute, 2018 |
| 6.5 km/h (2020) and 4.8 km/h (2022) peak-hour speed | BUET, reported 2023 |
| Slowest of 1,200 cities in 152 countries, speed index −0.60 | NBER city speed study, 2023 |
| Comfortable walking speed, 0.94–1.43 m/s | Bohannon & Williams Andrews, 2011 |
| Metro Rail (MRT Line 6) commercial speed ~35 km/h | DMTCL, 2023 |

**Illustrative.** No source; the shape was invented to make a chart legible. The
hourly clock, the corridor map, the simulated corridor speeds, the per-corridor
hours lost and the night-time speed are in this category. Every chart that
uses them shows the "Illustrative — not sourced" chip, and the footer repeats
it.

## The simulation is a model, not an animation

`traffic-model.ts` imports nothing from Three. Each vehicle picks its speed
from the gap ahead — `want = min(vmax, (gap - minGap) / headway)` — clamped by
acceleration and braking limits, with an occasional random brake tap that seeds
stop-start waves. The queues are emergent.

Three is loaded by a dynamic import in `sections/street/index.ts`, fired by an
IntersectionObserver a screen before the section arrives, and Rollup keeps it
in its own chunk. Both canvases stop their animation loop when off screen.
Under `prefers-reduced-motion` the 3D scene paints a single static frame and
the charts appear without transitions.

## Deploying

`npm run build` writes a fully static `dist/`. There is no server, no API and
no cookies, so any static host will do.
