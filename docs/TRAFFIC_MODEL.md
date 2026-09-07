# The traffic model

## What is measured, and what is not

**Nothing about journey times on this network has been measured yet.**

That sentence is the most important one in this document, and the system is built
so that it cannot be quietly forgotten. Every travel time carries the tier that
produced it, all the way from `estimateLeg()` to the sentence on screen.

## The source hierarchy

`src/core/traffic/hierarchy.ts` resolves every leg through five tiers, taking the
first that can answer:

| Tier | What it is | Credence | Available today |
|---|---|---|---|
| `observed` | A recent measurement of this road | 1.00 | **No** — needs a live feed |
| `profile` | A statistic over collected samples | 0.85 | **No** — needs collection |
| `predicted` | A fitted model | 0.70 | **No** — needs the above first |
| `baseline` | The road's modeled speeds, shaped by hour | 0.35 | Yes |
| `freeflow` | The road with no traffic at all | 0.15 | Yes (last resort) |

The unavailable tiers return `null`. They do not fall through to something that
looks similar and get labelled as though they had answered.

`profile` activates by itself the moment `scripts/build/network-times.mjs`
writes a non-empty file. No code changes. This was verified by generating a
synthetic collection run: the tier flipped from `baseline` to `profile`,
coverage went from 0% to 100%, and confidence rose from LOW (31/100) to
MEDIUM (62/100) with no edit to any source file.

## The modeled baseline

With nothing collected, every leg resolves here.

```
speed(road, hour, dayType)
```

A city-wide hourly curve (`HOURLY_SPEED_KMH` in `src/data/traffic.ts`) sets the
*shape* of the day; each road's own `peakKmh` and `freeKmh` set the *range*. At
the worst hour a road runs at its peak-hour speed; at the best, at free flow.

On a weekend the congestion — the gap between free flow and peak — is scaled by
`WEEKEND_RELIEF` for that hour rather than removed, because Dhaka's roads do not
empty at the weekend, they only stop being commuted on.

The street simulation uses the same rule, so the two cannot tell different
stories about the same hour.

**These speeds are assigned, not measured.** They were chosen to match the
ordering these roads are reported to have. They are plausible; they are not
findings, and nothing derived from them should be cited as an observation.

## Time-dependent routing

Each leg is priced at the hour it is *reached*, not the hour of departure:

```ts
const leg = legFor(road, from, hour + minutesSoFar / 60, dayType);
```

Dijkstra relaxes edges the same way. This is valid here because arriving
somewhere earlier never makes you arrive later — the network has no scheduled
services to miss.

This matters more than it sounds. Costing a whole route at the departure hour
produced a visible absurdity: a journey broken by a 45-minute meal could come out
*faster* than the same journey driven straight through, because only the former
had its later legs priced at a later, quieter hour. With time-dependent costing
the two are comparable, and a genuinely interesting effect survives: a long
enough stop really can shorten the remaining drive by putting it past the peak.
The system reports that as a saving and says why.

## Uncertainty

`src/data/intelligence.ts` → `VARIABILITY`:

```
spread = base + growth × congestion²
```

with `base = 0.08`, `growth = 0.45`, and `skew = 0.68` of the band falling on the
slow side.

The square is deliberate: a road at 90% congestion is far more than twice as
erratic as one at 45%, because once demand approaches capacity small disturbances
produce large delays. The skew is deliberate too — a journey can go
catastrophically wrong but cannot finish in negative time.

**These are assumptions, not measurements.** They follow well-established
findings about travel-time distributions in general; they are not calibrated
against Dhaka observations, because there are none.

## Confidence versus reliability

Constantly conflated, and different:

- **Reliability** is about the world. A route through Mohakhali at six is
  unreliable because the traffic genuinely varies.
- **Confidence** is about our knowledge. A route can be perfectly predictable and
  still carry low confidence, because nobody has measured it.

`confidenceFor()` combines distance-weighted tier credence, sample depth,
recency, and route length. As shipped, every journey reports **LOW** confidence
and says why. That is correct, not a defect.

## Weather

Fetched from Open-Meteo. **Not applied to any travel time.**

Everyone knows Dhaka floods and everyone knows the roads seize when it does. The
question a model must answer is not "does rain slow traffic" but "by how much, on
this road, at this hour" — and answering it needs journey times measured in the
rain and compared against the same roads dry. No such series exists. Picking a
multiplier would be inventing the finding, and it would be invisible: every
estimate would shift by a number nobody could check.

So the forecast is shown, labelled as not applied, and the arithmetic is
untouched. After a monsoon of collection, the effect can be fitted and this
section can be replaced with a coefficient and the evidence for it.

## Machine learning

None. There is no model, and there is no data to fit one to.

The progression, when there is: historical median baseline → a linear model →
gradient boosting. Each must beat the historical baseline on MAE and RMSE against
held-out days before it is allowed to answer, and the `predicted` tier stays
`null` until one does. An LSTM or a graph network for a 39-edge network with no
training data would be decoration.

## Collecting the data

`scripts/dev/sampling-plan.mjs` computes what filling the table costs.

1,872 cells (39 roads × 24 hours × 2 day types). For quantile estimation each
needs roughly 30 samples minimum, 50 comfortable.

| Plan | Requests/day | Weeks to publishable peak distributions |
|---|---|---|
| Flat — one sample per road per hour | 936 | 10 |
| Peak-weighted | 1,950 | 3 |

Peak-weighting is **2.08× more expensive**, not cheaper — it buys speed, not
savings. A budget-neutral middle option holds 936/day but reallocates it away
from quiet overnight hours toward peaks, reaching publishable peak distributions
in about 7 weeks at the same cost.

Whichever is chosen: set a daily quota cap before the first real run, and note
that Ramadan, Eid and the monsoon change traffic materially — tag the collection
window and say which it covers.
