#!/usr/bin/env node
/**
 * Turns collected samples into the table the trip planner reads.
 *
 *   node scripts/build-network-times.mjs
 *
 * Writes src/data/measured/network-times.json — one entry per road, holding 24
 * hourly durations for a working day and 24 for a weekend. Where several
 * samples exist for the same cell the median is taken, so one blocked evening
 * cannot drag an hour on its own.
 *
 * The planner picks this up automatically and switches its own label from
 * "modeled" to "measured". Nothing else has to change.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw', 'network-times.ndjson');
const OUT = join(ROOT, 'src', 'data', 'measured', 'network-times.json');

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function main() {
  let text;
  try {
    text = await readFile(RAW, 'utf8');
  } catch {
    console.error(`No samples at ${RAW}. Run scripts/collect-network-times.mjs first.`);
    process.exit(1);
  }

  const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const good = rows.filter((r) => !r.error && typeof r.minutes === 'number');
  if (!good.length) {
    console.error('No usable samples. Nothing written.');
    process.exit(1);
  }

  // road -> dayType -> hour -> [minutes]
  const bucket = new Map();
  for (const r of good) {
    if (!bucket.has(r.road)) bucket.set(r.road, { working: {}, weekend: {}, free: [], km: [] });
    const entry = bucket.get(r.road);
    const day = entry[r.dayType];
    if (!day) continue;
    (day[r.localHour] ??= []).push(r.minutes);
    if (typeof r.freeMinutes === 'number') entry.free.push(r.freeMinutes);
    if (typeof r.meters === 'number') entry.km.push(r.meters / 1000);
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
    const working = hourly(entry.working);
    const weekend = hourly(entry.weekend);
    const full = working.every((v) => v !== null) && weekend.every((v) => v !== null);
    if (full) complete++;

    roads[road] = {
      km: entry.km.length ? +median(entry.km).toFixed(2) : null,
      freeMinutes: entry.free.length ? +median(entry.free).toFixed(2) : null,
      working,
      weekend,
    };
  }

  const departures = [...new Set(good.map((r) => r.departureTime).filter(Boolean))].sort();
  const out = {
    note: 'Generated. Do not edit by hand.',
    generatedAt: new Date().toISOString(),
    source: 'Google Routes API, predictive departureTime',
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
