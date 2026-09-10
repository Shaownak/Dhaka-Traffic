#!/usr/bin/env node
/**
 * Turns collected samples into the table the trip planner reads.
 *
 *   node scripts/build/network-times.mjs
 *
 * Writes src/data/measured/network-times.json — one entry per road, holding 24
 * hourly durations for a working day and 24 for a weekend. Where several
 * samples exist for the same cell the median is taken, so one blocked evening
 * cannot drag an hour on its own.
 *
 * These are Google forecasts, not observed journeys. The planner labels
 * them as provider forecasts and assigns zero observed samples.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'network-times.ndjson');
const OUT = join(ROOT, 'src', 'data', 'measured', 'network-times.json');

const median = (xs) => quantile(xs, 0.5);

/**
 * Linear-interpolated quantile.
 *
 * The planner needs p10 and p90 as well as the median: a road's spread is what
 * turns a point estimate into an honest range, and the confidence model reads
 * the sample count to decide how much to trust the spread at all.
 */
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

/** Enough observations in a cell for a p10/p90 to mean anything. */
const MIN_FOR_SPREAD = 5;

async function main() {
  let text;
  try {
    text = await readFile(RAW, 'utf8');
  } catch {
    console.error(`No samples at ${RAW}. Run scripts/collect/network-times.mjs first.`);
    process.exit(1);
  }

  const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const good = rows.filter((r) => !r.error && Number.isFinite(r.minutes) && r.minutes > 0
    && ['working', 'weekend'].includes(r.dayType) && Number.isInteger(r.localHour)
    && r.localHour >= 0 && r.localHour < 24 && typeof r.road === 'string');
  if (!good.length) {
    console.error('No usable samples. Nothing written.');
    process.exit(1);
  }

  // road -> dayType -> hour -> [minutes]
  const bucket = new Map();
  for (const r of good) {
    if (!bucket.has(r.road)) {
      bucket.set(r.road, { working: {}, weekend: {}, free: [], km: [], lastAt: null });
    }
    const entry = bucket.get(r.road);
    const day = entry[r.dayType];
    if (!day) continue;
    (day[r.localHour] ??= []).push(r.minutes);
    if (typeof r.freeMinutes === 'number') entry.free.push(r.freeMinutes);
    if (typeof r.meters === 'number') entry.km.push(r.meters / 1000);
    // Recency is per road: the confidence model ages a route by its oldest leg.
    if (r.collectedAt && (!entry.lastAt || r.collectedAt > entry.lastAt)) {
      entry.lastAt = r.collectedAt;
    }
  }

  const roads = {};
  let complete = 0;
  for (const [road, entry] of bucket) {
    const hourly = (day) => {
      const out = [];
      for (let h = 0; h < 24; h++) {
        const cell = day[h];
        out.push(cell?.length ? +median(cell).toFixed(2) : null);
      }
      return out;
    };
    // Per-cell statistics, so the planner can report a measured spread and the
    // confidence model can see how thin the evidence is.
    const stats = (day) => {
      const out = [];
      for (let h = 0; h < 24; h++) {
        const cell = day[h];
        if (!cell?.length) {
          out.push(null);
          continue;
        }
        out.push({
          n: cell.length,
          p50: +quantile(cell, 0.5).toFixed(2),
          // With too few samples a p10/p90 is just the min and max wearing a
          // percentile's name, so fall back to the median rather than publish
          // a spread the data cannot support.
          p10: +quantile(cell, cell.length >= MIN_FOR_SPREAD ? 0.1 : 0.5).toFixed(2),
          p90: +quantile(cell, cell.length >= MIN_FOR_SPREAD ? 0.9 : 0.5).toFixed(2),
        });
      }
      return out;
    };

    const working = hourly(entry.working);
    const weekend = hourly(entry.weekend);
    const full = working.every((v) => v !== null) && weekend.every((v) => v !== null);
    if (full) complete++;

    roads[road] = {
      km: entry.km.length ? +median(entry.km).toFixed(2) : null,
      freeMinutes: entry.free.length ? +median(entry.free).toFixed(2) : null,
      working,
      weekend,
      stats: { working: stats(entry.working), weekend: stats(entry.weekend) },
      lastForecastCollectedAt: entry.lastAt ?? null,
    };
  }

  const departures = [...new Set(good.map((r) => r.departureTime).filter(Boolean))].sort();
  const out = {
    note: 'Generated. Do not edit by hand.',
    generatedAt: new Date().toISOString(),
    source: 'Google Routes API, predictive departureTime',
    evidence: 'provider-estimate',
    departureDates: departures.length
      ? { from: departures[0], to: departures[departures.length - 1] }
      : null,
    sampleCount: good.length,
    roads,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');

  console.log(`samples   ${good.length} usable of ${rows.length}`);
  console.log(`roads     ${complete} of ${bucket.size} have all 48 hourly cells`);
  console.log(`written   ${OUT}`);
  if (complete < bucket.size) {
    console.log('\nRoads with gaps keep their modeled speeds; the planner mixes the two and says so.');
  }
}

await main();
