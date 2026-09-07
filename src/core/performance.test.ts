/**
 * Performance budgets for the planner.
 *
 * These are not micro-benchmarks for their own sake. The planner runs on the
 * reader's device, on the main thread, while a 3D scene may be rendering
 * elsewhere on the page — so a slow path here shows up as a janky interface,
 * not as a slow server. The budgets are deliberately loose enough not to be
 * flaky on a busy CI box and tight enough to catch an algorithmic regression.
 */
import { describe, expect, it } from 'vitest';
import { PLACES } from '../data/network';
import { DEPARTURE_SEARCH } from '../data/intelligence';
import { departureCurve, fastestRoute, routeOptions } from './routing/graph';
import { optimizeDeparture, rankRoutes } from './optimization/scoring';

function timeIt(runs: number, fn: () => void): number {
  fn(); // warm up, so the first-call cost of building lookups is excluded
  const start = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return (performance.now() - start) / runs;
}

describe('performance budgets', () => {
  it('finds a single fastest route in well under a millisecond', () => {
    const ms = timeIt(200, () => fastestRoute('uttara', 'postogola', 18, 'working'));
    expect(ms, `${ms.toFixed(3)} ms per call`).toBeLessThan(2);
  });

  it('enumerates route alternatives within frame budget', () => {
    // this is the expensive one: k-shortest-paths over the network
    const ms = timeIt(50, () => routeOptions('uttara', 'postogola', 18, 'working', 4));
    expect(ms, `${ms.toFixed(2)} ms per call`).toBeLessThan(16);
  });

  it('scores a candidate set almost for free', () => {
    const routes = routeOptions('gulshan', 'mohammadpur', 18, 'working', 4);
    const ms = timeIt(500, () => rankRoutes(routes, 'BALANCED'));
    expect(ms, `${ms.toFixed(3)} ms per call`).toBeLessThan(1);
  });

  it('builds a departure curve within frame budget', () => {
    const ms = timeIt(50, () => departureCurve('gulshan', 'mohammadpur', 16, 21, 'working'));
    expect(ms, `${ms.toFixed(2)} ms per call`).toBeLessThan(16);
  });

  it('runs the whole arrival-deadline search inside a second', () => {
    // the heaviest path in the app: one full rank per candidate departure
    const ms = timeIt(5, () => {
      optimizeDeparture(
        20 * 60,
        DEPARTURE_SEARCH.windowMinutes,
        DEPARTURE_SEARCH.intervalMinutes,
        DEPARTURE_SEARCH.bufferMinutes,
        (depart) => {
          const hour = Math.floor(depart / 60) % 24;
          const top = rankRoutes(routeOptions('gulshan', 'mohammadpur', hour, 'working', 4), 'BALANCED')[0];
          return top
            ? { travelMinutes: top.route.minutes, reliability: top.assessment.reliability, score: top.score }
            : null;
        },
      );
    });
    expect(ms, `${ms.toFixed(1)} ms per search`).toBeLessThan(1000);
  });

  it('stays bounded on the worst pair in the network', () => {
    // the two places furthest apart in hops are where enumeration explodes
    let worst = 0;
    let worstPair = '';
    for (const a of PLACES) {
      for (const b of PLACES) {
        if (a.id >= b.id) continue;
        const start = performance.now();
        routeOptions(a.id, b.id, 18, 'working', 4);
        const took = performance.now() - start;
        if (took > worst) {
          worst = took;
          worstPair = `${a.id} to ${b.id}`;
        }
      }
    }
    expect(worst, `worst pair ${worstPair} took ${worst.toFixed(1)} ms`).toBeLessThan(120);
  });
});

describe('measured profile', () => {
  it('prints where the time goes', () => {
    const profile: [string, number][] = [
      ['fastestRoute (single Dijkstra)', timeIt(200, () => fastestRoute('uttara', 'postogola', 18, 'working'))],
      ['routeOptions (k-shortest paths)', timeIt(50, () => routeOptions('uttara', 'postogola', 18, 'working', 4))],
      ['rankRoutes (scoring 4 routes)', timeIt(500, () => rankRoutes(routeOptions('gulshan', 'mohammadpur', 18, 'working', 4), 'BALANCED'))],
      ['departureCurve (6 hours)', timeIt(50, () => departureCurve('gulshan', 'mohammadpur', 16, 21, 'working'))],
    ];
    for (const [name, ms] of profile) {
      console.log(`  ${name.padEnd(34)} ${ms.toFixed(3)} ms`);
    }
    // enumeration cost grows with path count, so record how many there are
    const paths = routeOptions('uttara', 'postogola', 18, 'working', 99).length;
    console.log(`  distinct routes uttara->postogola   ${paths}`);
    expect(profile.length).toBe(4);
  });
});
