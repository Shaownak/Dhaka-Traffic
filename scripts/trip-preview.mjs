#!/usr/bin/env node
/**
 * Prints what the planner would say for one query, without a browser.
 * Handy for sanity-checking a route before trusting the UI.
 *
 *   node scripts/trip-preview.mjs gulshan mohammadpur 2026-09-05 evening
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// The source uses bundler-style extensionless imports, which Node will not
// resolve on its own. Retry a failed specifier with a .ts extension.
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    try {
      return await next(spec, ctx);
    } catch (err) {
      if (err && err.code === 'ERR_MODULE_NOT_FOUND' && !/\\.[a-z]+$/.test(spec)) {
        return next(spec + '.ts', ctx);
      }
      throw err;
    }
  }
`), pathToFileURL('./'));

const [from = 'gulshan', to = 'mohammadpur', date = '2026-09-05', window = 'evening'] = process.argv.slice(2);

const { TIME_WINDOWS } = await import('../src/data/network.ts');
const { fastestRoute, routeOptions, departureCurve, bestDeparture, dayTypeOf, placeName } =
  await import('../src/sections/trip/trip-model.ts');

const when = new Date(`${date}T12:00:00`);
const dayType = dayTypeOf(when);
const w = TIME_WINDOWS.find((x) => x.id === window) ?? TIME_WINDOWS[2];
const dayName = when.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });

const curve = departureCurve(from, to, w.from, w.to, dayType);
const best = bestDeparture(curve);
const worst = curve.reduce((a, b) => (b.minutes > a.minutes ? b : a));

const fmt = (m) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
const clock = (h) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`);

console.log(`\n${placeName(from)} to ${placeName(to)} — ${dayName} (${dayType} day), ${w.label.toLowerCase()}\n`);
console.log(`  Best departure   ${clock(best.hour)}, about ${fmt(best.minutes)}`);
console.log(`  Worst departure  ${clock(worst.hour)}, about ${fmt(worst.minutes)}`);
console.log(`  Cost of timing   ${fmt(worst.minutes - best.minutes)}\n`);

console.log('  Departure curve');
for (const p of curve) {
  const bar = '#'.repeat(Math.round(p.minutes / 2));
  console.log(`    ${clock(p.hour).padStart(6)}  ${String(Math.round(p.minutes)).padStart(3)} min  ${bar}`);
}

console.log('\n  Routes at the best hour');
for (const [i, r] of routeOptions(from, to, best.hour, dayType, 4).entries()) {
  console.log(`    ${i + 1}. ${fmt(r.minutes).padEnd(10)} ${r.km.toFixed(1)} km, ${fmt(r.delayMinutes)} of it delay`);
  console.log(`       via ${r.path.slice(1, -1).map(placeName).join(' -> ') || 'direct'}`);
}

const other = dayType === 'weekend' ? 'working' : 'weekend';
const otherBest = bestDeparture(departureCurve(from, to, w.from, w.to, other));
console.log(`\n  Same window on a ${other} day: ${fmt(otherBest.minutes)}\n`);
