#!/usr/bin/env node
/**
 * Network time collector — turns the trip planner's modeled speeds into
 * measured ones.
 *
 * Asks the Routes API how long each road takes at each hour, on a
 * representative working day and a representative weekend day. Uses a FUTURE
 * `departureTime`, so Google answers from its own traffic model rather than
 * from live conditions — which means the whole sweep runs in one sitting
 * instead of over four weeks.
 *
 *   GOOGLE_ROUTES_KEY=... node scripts/collect/network-times.mjs --dry-run
 *   GOOGLE_ROUTES_KEY=... node scripts/collect/network-times.mjs
 *   GOOGLE_ROUTES_KEY=... node scripts/collect/network-times.mjs --hours 6,9,13,18,21
 *
 * What this is and is not: Google's prediction of a typical Tuesday at 6 PM is
 * a real, dated, citable model output. It is not an observation of any actual
 * evening, and the methodology must say so. Run the 15-minute collector
 * alongside it to check the prediction against what the roads really did.
 *
 * Output: data/raw/network-times.ndjson, append only.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'data', 'raw', 'network-times.ndjson');
const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Dhaka is UTC+6 all year, so local hour and offset never drift. */
const DHAKA_OFFSET_HOURS = 6;

const DRY = process.argv.includes('--dry-run');
const KEY = process.env['GOOGLE_ROUTES_KEY'];

const hoursArg = process.argv.indexOf('--hours');
const HOURS = hoursArg > -1 && process.argv[hoursArg + 1]
  ? process.argv[hoursArg + 1].split(',').map(Number)
  : Array.from({ length: 24 }, (_, h) => h);

if (!KEY && !DRY) {
  console.error('GOOGLE_ROUTES_KEY is not set. Pass --dry-run to see the plan without calling the API.');
  process.exit(1);
}

/** Read PLACES and ROADS straight out of the TypeScript source. */
async function loadNetwork() {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(join(ROOT, 'src', 'data', 'network.ts'), 'utf8');

  const places = new Map();
  const placeRe = /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']+)',[^}]*lat:\s*([\d.]+),\s*lon:\s*([\d.]+)\s*\}/g;
  for (const m of src.matchAll(placeRe)) {
    places.set(m[1], { id: m[1], name: m[2], lat: +m[3], lon: +m[4] });
  }

  const roads = [];
  const roadRe = /\{\s*a:\s*'([^']+)',\s*b:\s*'([^']+)',\s*km:\s*([\d.]+),[^}]*?\}/g;
  for (const m of src.matchAll(roadRe)) {
    roads.push({ a: m[1], b: m[2], km: +m[3] });
  }
  return { places, roads };
}

/** The next occurrence of `weekday` at `hour`, Dhaka time, as a UTC instant. */
function nextLocal(weekday, hour) {
  const now = new Date();
  const probe = new Date(now.getTime() + DHAKA_OFFSET_HOURS * 3600_000);
  for (let add = 1; add <= 14; add++) {
    const day = new Date(probe.getTime() + add * 86400_000);
    if (day.getUTCDay() !== weekday) continue;
    return new Date(Date.UTC(
      day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, 0, 0,
    ) - DHAKA_OFFSET_HOURS * 3600_000);
  }
  throw new Error('no matching weekday within a fortnight');
}

async function sample(from, to, departure) {
  const body = {
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lon } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lon } } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
    departureTime: departure.toISOString(),
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask': 'routes.duration,routes.staticDuration,routes.distanceMeters',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);

  const route = (await res.json()).routes?.[0];
  if (!route) throw new Error('no route returned');

  const seconds = Number(String(route.duration).replace('s', ''));
  const freeSeconds = Number(String(route.staticDuration).replace('s', ''));
  const meters = Number(route.distanceMeters);
  return {
    kmh: +((meters / 1000) / (seconds / 3600)).toFixed(2),
    freeFlowKmh: +((meters / 1000) / (freeSeconds / 3600)).toFixed(2),
    minutes: +(seconds / 60).toFixed(2),
    freeMinutes: +(freeSeconds / 60).toFixed(2),
    meters,
  };
}

async function main() {
  const { places, roads } = await loadNetwork();
  // 2 = Tuesday, a plain working day. 6 = Saturday, the weekend.
  const days = [
    { weekday: 2, dayType: 'working' },
    { weekday: 6, dayType: 'weekend' },
  ];
  const total = roads.length * HOURS.length * days.length;

  console.log(`${places.size} places, ${roads.length} roads`);
  console.log(`${HOURS.length} hours x ${days.length} day types = ${total} requests`);

  if (DRY) {
    const [first] = roads;
    const from = places.get(first.a);
    const to = places.get(first.b);
    const when = nextLocal(2, 18);
    console.log(`\nExample: ${from.name} to ${to.name}, Tuesday 6 PM Dhaka`);
    console.log(`departureTime ${when.toISOString()}`);
    console.log('\nNo request was sent. Verify the coordinates against a map before a real run.');
    return;
  }

  await mkdir(dirname(OUT), { recursive: true });
  let done = 0;
  let failed = 0;

  for (const day of days) {
    for (const hour of HOURS) {
      const departure = nextLocal(day.weekday, hour);
      const rows = [];
      for (const road of roads) {
        const from = places.get(road.a);
        const to = places.get(road.b);
        if (!from || !to) continue;
        try {
          const result = await sample(from, to, departure);
          rows.push({
            collectedAt: new Date().toISOString(),
            departureTime: departure.toISOString(),
            dayType: day.dayType,
            localHour: hour,
            road: `${road.a}|${road.b}`,
            a: road.a,
            b: road.b,
            ...result,
          });
        } catch (err) {
          failed++;
          rows.push({
            collectedAt: new Date().toISOString(),
            dayType: day.dayType,
            localHour: hour,
            road: `${road.a}|${road.b}`,
            error: String(err instanceof Error ? err.message : err),
          });
        }
        done++;
      }
      await appendFile(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
      console.log(`  ${day.dayType} ${String(hour).padStart(2, '0')}:00  ${done}/${total}`);
    }
  }

  console.log(`\n${done - failed} of ${total} succeeded, ${failed} failed -> ${OUT}`);
  console.log('Next: node scripts/build/network-times.mjs');
}

await main();
