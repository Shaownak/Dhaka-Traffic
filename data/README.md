# Data

Two kinds of number appear on this page, and the distinction is the point.

**Measured.** Published by a named institution, transcribed as stated, and shown
beside a chip linking to the citation. These are in `SOURCES` in
[`src/data/traffic.ts`](../src/data/traffic.ts).

**Modeled.** No public series exists, so the shape was built to be plausible.
These are labeled in the provenance ledger (`DATASETS`, same file) and rendered
into the methodology section on the page. They are not findings and must not be
cited as observations.

The ledger is the single source of truth: the methodology section renders from
it, so the page cannot describe its sourcing differently from the way the charts
are actually fed.

## Turning modeled numbers into measured ones

The hourly clock, the corridor map, and the simulation inputs all need the same
thing: how long a fixed trip takes at each hour of the day, over enough days to
average out incidents.

```bash
GOOGLE_ROUTES_KEY=your-key node scripts/collect-corridor-speeds.mjs --dry-run
```

Then run it on a schedule — every 15 minutes for four weeks:

```bash
*/15 * * * * cd /path/to/project && GOOGLE_ROUTES_KEY=your-key node scripts/collect-corridor-speeds.mjs
```

At six corridors every 15 minutes, that is 576 calls a day and about 16,000 over
four weeks — a few tens of dollars at current Routes API pricing, and the single
change that would move most of this page from modeled to measured.

## The pipeline

```
collect-corridor-speeds.mjs   →  data/raw/corridor-speeds.ndjson   (append only)
aggregate-speeds.mjs          →  src/data/measured/hourly.json     (regenerated)
you                           →  src/data/traffic.ts               (deliberate)
```

The last step is manual on purpose. A cron job must never be able to rewrite
the story's numbers on its own — a bad collection window would silently change
published figures. The aggregator tells you when there is enough data and what
to copy; you decide when a dataset graduates from modeled to measured.

```bash
node scripts/aggregate-speeds.mjs
```

It drops failed samples, drops Friday and Saturday, requires at least five
samples in an hour-of-day cell before reporting it, and gives the median with
the interquartile range so the spread is publishable alongside the value. Add
`--include-weekends` to look at weekend traffic as its own question.

## Air quality

`collect-air-quality.mjs` samples OpenAQ v3 for Dhaka's PM2.5 monitors — free,
openly licensed, citable. Get a key at explore.openaq.org.

One caution, in the script and repeated here: traffic is one source of Dhaka's
PM2.5, not the dominant one. Brick kilns and construction dust are large and
seasonal contributors. Correlating a speed series against a PM2.5 series will
produce a number, and that number will not be causal.

## Automation

`.github/workflows/collect.yml` runs both collectors on a schedule and commits
the samples. Keys live in repository secrets.

**Nothing calls these APIs from the page.** A static site has no server to hide
a key behind, cost would scale with readers rather than with data, and a page
whose numbers change between visits cannot be cited or fact-checked. Collection
happens on a schedule; the published page stays a snapshot with a stated window.

GitHub's scheduler drifts, sometimes by ten minutes or more. That is tolerable
here only because every row is stamped with the time it was actually collected
and the aggregator buckets by that stamp rather than the intended slot. If you
need tighter timing, run the same script from cron on any always-on machine.

## Schema

`data/raw/corridor-speeds.ndjson`, one JSON object per corridor per sample,
append only. Never rewrite history: filter a bad run at analysis time instead,
so past numbers cannot silently change.

| Field | Type | Meaning |
|---|---|---|
| `collectedAt` | ISO 8601 | Sample time, UTC |
| `localHour` | 0–23 | Hour in Dhaka (UTC+6), the axis the clock chart needs |
| `localMinute` | 0–59 | Minute in Dhaka |
| `weekday` | 0–6 | 0 = Sunday. **5 and 6 are the Bangladeshi weekend** and must be analyzed separately, not averaged into the work week |
| `corridor` | string | Stable id, matches the corridor list in the script |
| `name` | string | Human-readable corridor name |
| `kmh` | number | Observed average speed over the trip |
| `freeFlowKmh` | number | Same trip with no traffic — the baseline delay is measured against |
| `delaySeconds` | number | `seconds − freeSeconds`: the congestion, isolated |
| `seconds` / `freeSeconds` | number | Raw durations behind those speeds |
| `meters` | number | Route distance |
| `error` | string | Present instead of the measures when a sample failed |

## Analysis notes

- **Weekends are not the work week.** Friday and Saturday are the weekend in
  Bangladesh. Averaging all seven days flattens the peaks that make this story.
- **Delay, not speed, is the quantity to report.** `delaySeconds` isolates
  congestion from distance; a slow corridor and a long corridor are not the
  same finding.
- **Median beats mean per hour-of-day cell.** A single blocked road or a VIP
  movement will otherwise drag an hour's average down on its own.
- **Report a range.** With four weeks of samples each hour-of-day cell holds
  about 20 weekday observations; publish the interquartile range alongside the
  central value rather than a bare point estimate.
- **Ramadan, Eid, and the monsoon** change traffic materially. Tag the
  collection window and say which it covers.
