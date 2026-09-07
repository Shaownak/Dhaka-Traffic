#!/usr/bin/env node
/**
 * Corridor speed collector — turns the modeled numbers on this page into
 * measured ones.
 *
 * Samples the Google Routes API for a fixed set of origin-destination pairs on
 * a schedule, recording how long the same trip takes at each hour of the day.
 * Run it every 15 minutes for four weeks and the hourly clock, the corridor
 * map, and the simulation inputs all stop being invented.
 *
 *   GOOGLE_ROUTES_KEY=... node scripts/collect/corridor-speeds.mjs
 *   GOOGLE_ROUTES_KEY=... node scripts/collect/corridor-speeds.mjs --dry-run
 *
 * Cron, every 15 minutes:
 *   *_/15 * * * * cd /path/to/project && GOOGLE_ROUTES_KEY=... node scripts/collect/corridor-speeds.mjs
 *   (remove the underscore; it is there so this comment is not a block end)
 *
 * Output: data/raw/corridor-speeds.ndjson, one JSON object per sample. Append
 * only — never rewrite history, so a bad run can be filtered out later rather
 * than silently changing past numbers.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'data', 'raw', 'corridor-speeds.ndjson');
const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * The corridors this story talks about. Coordinates are the road ends, not the
 * neighborhood centroids, so the measured distance matches the drive.
 * Verify each pair once on a map before trusting a run.
 */
const CORRIDORS = [
  { id: 'mohakhali-farmgate', name: 'Mohakhali to Farmgate', from: [23.7806, 90.4053], to: [23.7578, 90.3899] },
  { id: 'airport-banani', name: 'Airport Road to Banani', from: [23.8513, 90.4085], to: [23.7936, 90.4043] },
  { id: 'farmgate-shahbagh', name: 'Farmgate to Shahbagh', from: [23.7578, 90.3899], to: [23.7381, 90.3958] },
  { id: 'mirpur-shyamoli', name: 'Mirpur to Shyamoli', from: [23.8042, 90.3667], to: [23.7746, 90.3663] },
  { id: 'uttara-airport', name: 'Uttara to Airport', from: [23.8759, 90.3795], to: [23.8513, 90.4085] },
  { id: 'badda-bashundhara', name: 'Badda to Bashundhara', from: [23.7806, 90.4256], to: [23.8203, 90.4300] },
];

const DRY = process.argv.includes('--dry-run');
const KEY = process.env['GOOGLE_ROUTES_KEY'];

if (!KEY && !DRY) {
  console.error('GOOGLE_ROUTES_KEY is not set. Pass --dry-run to see the request shape without calling the API.');
  process.exit(1);
}

/** One sample of one corridor, right now. */
async function sample(corridor) {
  const body = {
    origin: { location: { latLng: { latitude: corridor.from[0], longitude: corridor.from[1] } } },
    destination: { location: { latLng: { latitude: corridor.to[0], longitude: corridor.to[1] } } },
    travelMode: 'DRIVE',
    // TRAFFIC_AWARE_OPTIMAL is the slower, more accurate model; at one call per
    // corridor per quarter hour the extra cost is immaterial and the numbers
    // are the ones worth having.
    routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    departureTime: new Date(Date.now() + 60_000).toISOString(),
  };

  if (DRY) {
    return { dryRun: true, request: body };
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`${corridor.id}: HTTP ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  const route = json.routes?.[0];
  if (!route) throw new Error(`${corridor.id}: no route returned`);

  const seconds = Number(String(route.duration).replace('s', ''));
  // staticDuration is the same trip with no traffic: the free-flow baseline,
  // which is what makes delay measurable rather than assumed.
  const freeSeconds = Number(String(route.staticDuration).replace('s', ''));
  const meters = Number(route.distanceMeters);

  return {
    kmh: +((meters / 1000) / (seconds / 3600)).toFixed(2),
    freeFlowKmh: +((meters / 1000) / (freeSeconds / 3600)).toFixed(2),
    delaySeconds: seconds - freeSeconds,
    seconds,
    freeSeconds,
    meters,
  };
}

async function main() {
  const now = new Date();
  // Dhaka is UTC+6 year round, so the local hour is what the clock chart needs
  const dhaka = new Date(now.getTime() + 6 * 3600_000);
  const rows = [];

  for (const corridor of CORRIDORS) {
    try {
      const result = await sample(corridor);
      rows.push({
        collectedAt: now.toISOString(),
        localHour: dhaka.getUTCHours(),
        localMinute: dhaka.getUTCMinutes(),
        // 0 = Sunday. Friday (5) and Saturday (6) are the Bangladeshi weekend
        // and should be analyzed separately, not averaged into the work week.
        weekday: dhaka.getUTCDay(),
        corridor: corridor.id,
        name: corridor.name,
        ...result,
      });
    } catch (err) {
      rows.push({
        collectedAt: now.toISOString(),
        corridor: corridor.id,
        error: String(err instanceof Error ? err.message : err),
      });
    }
  }

  if (DRY) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  await mkdir(dirname(OUT), { recursive: true });
  await appendFile(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  const ok = rows.filter((r) => !r.error).length;
  console.log(`${new Date().toISOString()}  ${ok}/${rows.length} corridors written to ${OUT}`);
}

await main();
