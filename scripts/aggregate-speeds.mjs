#!/usr/bin/env node
/**
 * Aggregator — the step between collection and the page.
 *
 * Reads the raw samples, throws away what should not be averaged, and produces
 * the hourly profile and corridor speeds the charts need. Reports the spread
 * alongside the central value, because a single number per hour is a claim the
 * data cannot support.
 *
 *   node scripts/aggregate-speeds.mjs
 *   node scripts/aggregate-speeds.mjs --include-weekends
 *
 * Writes src/data/measured/hourly.json. Nothing is overwritten in traffic.ts
 * automatically: the last step is yours, so a bad collection window cannot
 * silently rewrite the story.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw', 'corridor-speeds.ndjson');
const OUT = join(ROOT, 'src', 'data', 'measured', 'hourly.json');

/** Friday and Saturday. Averaging them into the work week flattens the peaks. */
const WEEKEND = new Set([5, 6]);
const INCLUDE_WEEKENDS = process.argv.includes('--include-weekends');

/** At least this many samples in an hour-of-day cell before it is reported. */
const MIN_SAMPLES = 5;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
};

async function main() {
  let text;
  try {
    text = await readFile(RAW, 'utf8');
  } catch {
    console.error(`No samples yet at ${RAW}. Run scripts/collect-corridor-speeds.mjs first.`);
    process.exit(1);
  }

  const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const usable = rows.filter((r) => !r.error && typeof r.kmh === 'number');
  const kept = usable.filter((r) => INCLUDE_WEEKENDS || !WEEKEND.has(r.weekday));

  if (!kept.length) {
    console.error('No usable samples after filtering. Nothing written.');
    process.exit(1);
  }

  const times = kept.map((r) => new Date(r.collectedAt).getTime());
  const window = {
    from: new Date(Math.min(...times)).toISOString(),
    to: new Date(Math.max(...times)).toISOString(),
    days: +((Math.max(...times) - Math.min(...times)) / 86400000).toFixed(1),
  };

  // hour-of-day profile across all corridors
  const byHour = [];
  for (let h = 0; h < 24; h++) {
    const cell = kept.filter((r) => r.localHour === h).map((r) => r.kmh);
    byHour.push(cell.length >= MIN_SAMPLES
      ? {
        hour: h,
        kmh: +median(cell).toFixed(2),
        p25: +quantile(cell, 0.25).toFixed(2),
        p75: +quantile(cell, 0.75).toFixed(2),
        samples: cell.length,
      }
      : { hour: h, kmh: null, samples: cell.length, note: 'too few samples' });
  }

  // per corridor: peak-hour and free-flow, the two numbers the map and the
  // simulation actually consume
  const corridors = {};
  for (const r of kept) {
    (corridors[r.corridor] ??= { name: r.name, kmh: [], free: [], delay: [] });
    corridors[r.corridor].kmh.push(r.kmh);
    if (typeof r.freeFlowKmh === 'number') corridors[r.corridor].free.push(r.freeFlowKmh);
    if (typeof r.delaySeconds === 'number') corridors[r.corridor].delay.push(r.delaySeconds);
  }

  const corridorOut = Object.entries(corridors).map(([id, c]) => {
    const peakCell = kept.filter((r) => r.corridor === id && r.localHour >= 17 && r.localHour <= 20).map((r) => r.kmh);
    return {
      id,
      name: c.name,
      medianKmh: +median(c.kmh).toFixed(2),
      peakKmh: peakCell.length >= MIN_SAMPLES ? +median(peakCell).toFixed(2) : null,
      freeFlowKmh: c.free.length ? +median(c.free).toFixed(2) : null,
      medianDelayMinutes: c.delay.length ? +(median(c.delay) / 60).toFixed(1) : null,
      samples: c.kmh.length,
    };
  });

  const out = {
    generatedAt: new Date().toISOString(),
    window,
    weekendsIncluded: INCLUDE_WEEKENDS,
    totalSamples: rows.length,
    usableSamples: kept.length,
    droppedErrors: rows.length - usable.length,
    droppedWeekend: usable.length - kept.length,
    minSamplesPerCell: MIN_SAMPLES,
    hourly: byHour,
    corridors: corridorOut,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');

  const reported = byHour.filter((h) => h.kmh !== null).length;
  console.log(`window        ${window.from.slice(0, 10)} to ${window.to.slice(0, 10)} (${window.days} days)`);
  console.log(`samples       ${kept.length} usable of ${rows.length} (${out.droppedErrors} errors, ${out.droppedWeekend} weekend)`);
  console.log(`hours covered ${reported}/24 with at least ${MIN_SAMPLES} samples`);
  console.log(`written       ${OUT}`);

  if (reported < 24) {
    console.log('\nNot every hour is covered yet. Keep collecting before replacing the modeled profile.');
  } else {
    console.log('\nAll 24 hours covered. To publish:');
    console.log('  1. Copy `hourly` into HOURLY_SPEED_KMH in src/data/traffic.ts');
    console.log('  2. Copy `corridors` peak/free values into CORRIDORS and LINKS');
    console.log('  3. Move those datasets from "modeled" to "measured" in DATASETS,');
    console.log('     adding a source entry naming the collection window above');
  }
}

await main();
