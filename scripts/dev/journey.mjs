#!/usr/bin/env node
/**
 * PLAN A JOURNEY from the command line, against the real engine.
 *
 *   node scripts/journey.mjs --from gulshan --to mirpur --at 17:00 --stop restaurant --at-position 0.5
 *   node scripts/journey.mjs --from gulshan --to mirpur --by 19:00
 *   node scripts/journey.mjs --ask "leave Gulshan at 5pm, eat halfway, reach Mirpur by 7"
 *
 * Same orchestrator the page and the API use, so what it prints is what they
 * would answer. Handy for checking a change without a browser.
 */
import { registerTsLoader } from '../lib/ts-loader.mjs';

registerTsLoader();

const { planJourney } = await import('../../src/core/journey/planner.ts');
const { parseJourneyText } = await import('../../src/core/nl/parse.ts');

/* ---------- arguments ---------- */
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const toMinutes = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : null;
};

const clock = (minutes) => {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
};
const mins = (n) => `${Math.round(n)} min`;

/* ---------- build the request ---------- */
const ask = flag('ask');
let request;

if (ask) {
  const parsed = parseJourneyText(ask, new Date());
  console.log('PARSED FROM TEXT');
  console.log(JSON.stringify(parsed, null, 2));
  console.log();
  if (!parsed.ok) {
    console.error('Could not read that request.');
    process.exit(1);
  }
  request = { ...parsed.request, date: new Date(parsed.request.date) };
} else {
  const date = flag('date') ? new Date(`${flag('date')}T12:00:00`) : new Date();
  request = {
    origin: flag('from', 'gulshan'),
    destination: flag('to', 'mirpur'),
    date,
    preference: flag('prefer', 'BALANCED').toUpperCase(),
  };
  const departAt = toMinutes(flag('at'));
  const arriveBy = toMinutes(flag('by'));
  if (departAt !== null) request.departAt = departAt;
  if (arriveBy !== null) request.arriveBy = arriveBy;
  if (departAt === null && arriveBy === null) request.departAt = 17 * 60;

  const stopKind = flag('stop');
  if (stopKind) {
    request.stop = {
      kinds: stopKind === 'any' ? ['restaurant', 'cafe', 'fast_food'] : [stopKind],
      position: Number(flag('at-position', '0.5')),
      dwellMinutes: Number(flag('dwell', '45')),
    };
    if (flag('cuisine')) request.stop.cuisine = flag('cuisine');
    if (has('open-only')) request.stop.requireOpen = true;
  }
}

/* ---------- plan ---------- */
const started = performance.now();
let plan;
try {
  plan = await planJourney(request);
} catch (err) {
  console.error(`${err.code ?? 'ERROR'}: ${err.message}`);
  process.exit(1);
}
const took = performance.now() - started;

/* ---------- print ---------- */
const line = (s = '') => console.log(s);

line(`${plan.origin.name} to ${plan.destination.name}`);
line(`${plan.date}, a ${plan.dayType} day. Optimizing for: ${plan.preference}`);
line();

if (plan.departure) {
  const d = plan.departure;
  line('WHEN TO LEAVE');
  line(`  recommended      ${clock(d.recommended)}`);
  line(`  earliest sensible ${clock(d.earliestSensible)}`);
  line(`  latest safe      ${clock(d.latestSafe)}`);
  line(`  arrive           ${clock(d.arrival.earliest)} to ${clock(d.arrival.latest)}`);
  line(`  buffer           ${mins(d.bufferMinutes)} before the deadline`);
  line();
}

const show = (o, index) => {
  const tag = o.labels.length ? `[${o.labels.join(', ')}]` : '';
  line(`${index === 0 ? 'RECOMMENDED' : `Alternative ${index}`} ${tag}`);
  line(`  ${o.km.toFixed(1)} km, ${mins(o.duration.expectedMinutes)} `
    + `(${mins(o.duration.bestMinutes)} to ${mins(o.duration.worstMinutes)})`);
  line(`  depart ${clock(plan.departAt)}, arrive ${clock(o.arrival.earliest)} to ${clock(o.arrival.latest)}`);
  line(`  traffic ${o.assessment.level}, reliability ${o.assessment.reliability} (${o.assessment.reliabilityLabel})`);
  line(`  confidence ${o.confidence.level} (${o.confidence.score}/100), `
    + `${Math.round(o.confidence.coverage * 100)}% measured, weakest source: ${o.confidence.weakestTier}`);
  if (o.stop) {
    const s = o.stop;
    line(`  STOP  ${s.name} (${s.kind}${s.cuisine ? `, ${s.cuisine}` : ''})`);
    line(`        ${Math.round(s.position * 100)}% along, via ${s.viaPlaceName}, `
      + `${s.accessKm.toFixed(2)} km from that junction`);
    line(`        arrive ${clock(s.arriveAt)}, stay ${mins(s.dwellMinutes)}, leave ${clock(s.departAt)}`);
    line(`        detour ${mins(s.detourMinutes)}, open: ${s.open}`);
  }
  line(`  via ${o.path.join(' > ')}`);
  line(`  because: ${o.reasons.join(', ')}`);
  line();
};

show(plan.recommended, 0);
plan.alternatives.forEach((o, i) => show(o, i + 1));

line('WHY');
line(`  ${plan.explanation}`);
line();

if (plan.notices.length) {
  line('NOTICES');
  for (const n of plan.notices) line(`  - ${n}`);
  line();
}
if (plan.attribution.length) line(`Data: ${plan.attribution.join('; ')}`);
line(`Planned in ${took.toFixed(1)} ms`);
