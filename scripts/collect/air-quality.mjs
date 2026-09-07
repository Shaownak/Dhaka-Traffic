#!/usr/bin/env node
/**
 * Air quality collector — congestion's other cost.
 *
 * Samples OpenAQ v3 for Dhaka's PM2.5 monitors. Free, openly licensed, and
 * citable, which is why it is here rather than a commercial AQI feed.
 *
 *   OPENAQ_KEY=... node scripts/collect/air-quality.mjs --dry-run
 *   OPENAQ_KEY=... node scripts/collect/air-quality.mjs
 *
 * Get a key at https://explore.openaq.org (free, instant).
 *
 * Output: data/raw/air-quality.ndjson, append only, same discipline as the
 * speed collector.
 *
 * A caution before this reaches the page: traffic is one source of Dhaka's
 * PM2.5, not the only one. Brick kilns and construction dust are large
 * contributors, and seasonal. Correlating a speed series against a PM2.5
 * series will produce a number, and that number will not be causal.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'data', 'raw', 'air-quality.ndjson');
const API = 'https://api.openaq.org/v3';

/** Dhaka, with a radius wide enough to catch the city's monitors. */
const CITY = { lat: 23.7808, lon: 90.4142, radiusMeters: 25000 };
const PARAMETER = 'pm25';

const DRY = process.argv.includes('--dry-run');
const KEY = process.env['OPENAQ_KEY'];

if (!KEY && !DRY) {
  console.error('OPENAQ_KEY is not set. Get one free at https://explore.openaq.org, or pass --dry-run.');
  process.exit(1);
}

async function get(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'X-API-Key': KEY } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const locationsPath =
    `/locations?coordinates=${CITY.lat},${CITY.lon}&radius=${CITY.radiusMeters}&limit=100`;

  if (DRY) {
    console.log('Would request:');
    console.log(`  GET ${API}${locationsPath}`);
    console.log('  then, for each PM2.5 sensor:');
    console.log(`  GET ${API}/sensors/{id}/measurements?limit=1`);
    console.log('\nOutput row shape:');
    console.log(JSON.stringify({
      collectedAt: new Date().toISOString(),
      localHour: 22,
      weekday: 3,
      locationId: 12345,
      location: 'Dhaka US Embassy',
      parameter: PARAMETER,
      value: 0,
      unit: 'µg/m³',
      measuredAt: new Date().toISOString(),
    }, null, 2));
    return;
  }

  const now = new Date();
  const dhaka = new Date(now.getTime() + 6 * 3600_000);
  const rows = [];

  const { results: locations = [] } = await get(locationsPath);

  for (const loc of locations) {
    const sensors = (loc.sensors ?? []).filter((s) => s.parameter?.name === PARAMETER);
    for (const sensor of sensors) {
      try {
        const { results = [] } = await get(`/sensors/${sensor.id}/measurements?limit=1`);
        const m = results[0];
        if (!m) continue;
        rows.push({
          collectedAt: now.toISOString(),
          localHour: dhaka.getUTCHours(),
          weekday: dhaka.getUTCDay(),
          locationId: loc.id,
          location: loc.name,
          parameter: PARAMETER,
          value: m.value,
          unit: sensor.parameter?.units ?? 'µg/m³',
          measuredAt: m.period?.datetimeTo?.utc ?? null,
        });
      } catch (err) {
        rows.push({
          collectedAt: now.toISOString(),
          locationId: loc.id,
          error: String(err instanceof Error ? err.message : err),
        });
      }
    }
  }

  if (!rows.length) {
    console.error('No PM2.5 sensors returned for Dhaka. Check the radius or the key.');
    process.exit(1);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await appendFile(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  const ok = rows.filter((r) => !r.error);
  const values = ok.map((r) => r.value).filter((v) => typeof v === 'number');
  const mean = values.length ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : 'n/a';
  console.log(`${now.toISOString()}  ${ok.length}/${rows.length} sensors, mean PM2.5 ${mean} µg/m³ -> ${OUT}`);
}

await main();
