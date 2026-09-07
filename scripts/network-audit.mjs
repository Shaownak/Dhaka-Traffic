#!/usr/bin/env node
/**
 * NETWORK AUDIT — is the routable graph actually good enough to plan on?
 *
 *   node scripts/network-audit.mjs
 *
 * A planner is only as honest as the graph under it. This reports the things
 * that quietly degrade an answer without ever throwing an error: pairs with no
 * route, pairs with only one route (where "alternatives" is a lie), trips that
 * hit the hop ceiling, and places barely connected to anything.
 */
import { registerTsLoader } from './lib/ts-loader.mjs';

registerTsLoader();

const { PLACES, ROADS } = await import('../src/data/network.ts');
const { fastestRoute, routeOptions } = await import('../src/core/routing/graph.ts');

const HOUR = 18;
const DAY = 'working';

console.log('NETWORK AUDIT\n');
console.log(`${PLACES.length} places, ${ROADS.length} roads\n`);

/* ---------- degree ---------- */
const degree = new Map(PLACES.map((p) => [p.id, 0]));
for (const r of ROADS) {
  degree.set(r.a, (degree.get(r.a) ?? 0) + 1);
  degree.set(r.b, (degree.get(r.b) ?? 0) + 1);
}
const leaves = [...degree.entries()].filter(([, d]) => d <= 1);
console.log(`A. Connectivity`);
console.log(`   dead ends (one road only): ${leaves.length ? leaves.map(([id]) => id).join(', ') : 'none'}`);

/* ---------- reachability and alternatives ---------- */
let pairs = 0;
let unreachable = 0;
let single = 0;
let maxHops = 0;
let maxHopsPair = '';
const thinPairs = [];

for (const a of PLACES) {
  for (const b of PLACES) {
    if (a.id >= b.id) continue;
    pairs++;
    const fast = fastestRoute(a.id, b.id, HOUR, DAY);
    if (!fast) {
      unreachable++;
      continue;
    }
    const hops = fast.path.length - 1;
    if (hops > maxHops) {
      maxHops = hops;
      maxHopsPair = `${a.id} to ${b.id}`;
    }
    const options = routeOptions(a.id, b.id, HOUR, DAY, 4).length;
    if (options < 2) {
      single++;
      thinPairs.push(`${a.id}>${b.id} (${hops} hops)`);
    }
  }
}

const pct = (n) => `${((n / pairs) * 100).toFixed(1)}%`;
console.log(`\nB. Routing across ${pairs} place pairs`);
console.log(`   unreachable:        ${unreachable} (${pct(unreachable)})`);
console.log(`   only one option:    ${single} (${pct(single)})`);
console.log(`   deepest fastest path: ${maxHops} hops (${maxHopsPair})`);

if (thinPairs.length) {
  console.log(`\n   pairs offering no alternative:`);
  for (const p of thinPairs.slice(0, 25)) console.log(`     ${p}`);
  if (thinPairs.length > 25) console.log(`     ... and ${thinPairs.length - 25} more`);
}

console.log(`\nC. Reading`);
if (maxHops >= 9) {
  console.log(`   The deepest trip needs ${maxHops} hops. Any enumeration ceiling at or`);
  console.log(`   below that silently returns a single route for the longest trips —`);
  console.log(`   which is where a reader most wants a choice.`);
} else {
  console.log(`   Deepest trip is ${maxHops} hops, so a ceiling above that enumerates fully.`);
}
