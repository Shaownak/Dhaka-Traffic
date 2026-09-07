import { describe, expect, it } from 'vitest';
import { PREFERENCES } from '../../data/intelligence';
import { fastestRoute, routeOptions } from '../routing/graph';
import {
  assess,
  congestionScore,
  explain,
  optimizeDeparture,
  rankRoutes,
  reliabilityFor,
  reliabilityLabel,
  riskLevel,
  trafficLevel,
  uncertaintyFor,
  weightsFor,
} from './scoring';

describe('congestion', () => {
  it('is zero at free flow and one at a standstill', () => {
    expect(congestionScore(40, 40)).toBe(0);
    expect(congestionScore(0, 40)).toBe(1);
    expect(congestionScore(20, 40)).toBeCloseTo(0.5, 6);
  });

  it('clamps rather than going negative when a road beats free flow', () => {
    expect(congestionScore(60, 40)).toBe(0);
  });

  it('survives a zero free-flow speed without dividing by it', () => {
    expect(congestionScore(10, 0)).toBe(0);
  });

  it('maps to the expected bands', () => {
    expect(trafficLevel(0.05)).toBe('FREE');
    expect(trafficLevel(0.30)).toBe('LIGHT');
    expect(trafficLevel(0.50)).toBe('MODERATE');
    expect(trafficLevel(0.70)).toBe('HEAVY');
    expect(trafficLevel(0.95)).toBe('SEVERE');
  });
});

describe('uncertainty', () => {
  it('brackets the expected time', () => {
    const u = uncertaintyFor(40, 0.5);
    expect(u.bestMinutes).toBeLessThan(u.expectedMinutes);
    expect(u.worstMinutes).toBeGreaterThan(u.expectedMinutes);
  });

  it('leans slow, because a trip cannot finish early the way it can run late', () => {
    const u = uncertaintyFor(40, 0.6);
    const upside = u.expectedMinutes - u.bestMinutes;
    const downside = u.worstMinutes - u.expectedMinutes;
    expect(downside).toBeGreaterThan(upside);
  });

  it('widens with congestion, and faster than linearly', () => {
    const width = (c: number) => {
      const u = uncertaintyFor(40, c);
      return u.worstMinutes - u.bestMinutes;
    };
    expect(width(0.8)).toBeGreaterThan(width(0.4));
    // doubling congestion should more than double the spread it contributes
    expect(width(0.8) - width(0)).toBeGreaterThan(2 * (width(0.4) - width(0)));
  });
});

describe('reliability and risk', () => {
  it('scores a tight band higher than a wide one', () => {
    const tight = reliabilityFor(uncertaintyFor(40, 0.1));
    const wide = reliabilityFor(uncertaintyFor(40, 0.9));
    expect(tight).toBeGreaterThan(wide);
  });

  it('stays within 0 and 100', () => {
    for (const c of [0, 0.25, 0.5, 0.75, 1]) {
      const score = reliabilityFor(uncertaintyFor(40, c));
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('labels every score', () => {
    for (const s of [100, 90, 80, 70, 50, 20, 0]) {
      expect(reliabilityLabel(s)).toBeTruthy();
    }
  });

  it('escalates risk with congestion', () => {
    const calm = assess(fastestRoute('gulshan', 'mohammadpur', 3, 'working')!);
    const peak = assess(fastestRoute('gulshan', 'mohammadpur', 18, 'working')!);
    expect(peak.risk).toBeGreaterThan(calm.risk);
    expect(riskLevel(0.1)).toBe('LOW');
    expect(riskLevel(0.9)).toBe('SEVERE');
  });
});

describe('assessment', () => {
  it('reports modeled basis while no times have been collected', () => {
    const a = assess(fastestRoute('gulshan', 'mohammadpur', 18, 'working')!);
    expect(a.basis).toBe('modeled');
  });

  it('names the worst stretch', () => {
    const a = assess(fastestRoute('uttara', 'motijheel', 18, 'working')!);
    expect(a.worstLeg).not.toBeNull();
    expect(a.worstLeg!.via.length).toBeGreaterThan(0);
  });
});

describe('scoring engine', () => {
  const routes = () => routeOptions('gulshan', 'mohammadpur', 18, 'working', 4);

  it('every preference profile sums to one', () => {
    for (const p of PREFERENCES) {
      const w = p.weights;
      const total = w.eta + w.reliability + w.traffic + w.distance + w.simplicity;
      expect(total, p.id).toBeCloseTo(1, 6);
    }
  });

  it('ranks highest score first', () => {
    const ranked = rankRoutes(routes(), 'BALANCED');
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i]!.score).toBeLessThanOrEqual(ranked[i - 1]!.score);
    }
  });

  // These two are the load-bearing promises of the preference control: if
  // "Fastest" ever returns something slower than an option beside it, the
  // control is lying. Checked across the clock and both day types, not just
  // at one convenient hour.
  const everyCase: [number, 'working' | 'weekend'][] = [];
  for (const h of [3, 8, 13, 18, 21]) {
    everyCase.push([h, 'working'], [h, 'weekend']);
  }

  it('FASTEST picks the quickest route, at every hour', () => {
    for (const [hour, dayType] of everyCase) {
      const all = routeOptions('gulshan', 'mohammadpur', hour, dayType, 4);
      if (all.length < 2) continue;
      const ranked = rankRoutes(all, 'FASTEST');
      const quickest = Math.min(...all.map((r) => r.minutes));
      expect(ranked[0]!.route.minutes, `${hour}h ${dayType}`).toBeCloseTo(quickest, 6);
    }
  });

  it('SHORTEST picks the shortest route, at every hour', () => {
    for (const [hour, dayType] of everyCase) {
      const all = routeOptions('gulshan', 'mohammadpur', hour, dayType, 4);
      if (all.length < 2) continue;
      const ranked = rankRoutes(all, 'SHORTEST');
      const shortest = Math.min(...all.map((r) => r.km));
      expect(ranked[0]!.route.km, `${hour}h ${dayType}`).toBeCloseTo(shortest, 6);
    }
  });

  it('preference actually changes the outcome somewhere in the city', () => {
    // over a set of trips, fastest and shortest must disagree at least once,
    // or the preference control is decorative
    let disagreements = 0;
    const pairs: [string, string][] = [
      ['uttara', 'motijheel'], ['gulshan', 'mohammadpur'],
      ['mirpur10', 'jatrabari'], ['bashundhara', 'azimpur'],
    ];
    for (const [from, to] of pairs) {
      const all = routeOptions(from, to, 18, 'working', 4);
      if (all.length < 2) continue;
      const fast = rankRoutes(all, 'FASTEST')[0]!.route.path.join('>');
      const short = rankRoutes(all, 'SHORTEST')[0]!.route.path.join('>');
      if (fast !== short) disagreements++;
    }
    expect(disagreements).toBeGreaterThan(0);
  });

  it('is deterministic: the same input scores identically every time', () => {
    const a = rankRoutes(routes(), 'BALANCED').map((r) => r.score);
    const b = rankRoutes(routes(), 'BALANCED').map((r) => r.score);
    expect(a).toEqual(b);
  });

  it('gives every route at least one reason', () => {
    for (const r of rankRoutes(routes(), 'BALANCED')) {
      expect(r.reasons.length).toBeGreaterThan(0);
    }
  });

  it('falls back to balanced weights for an unknown preference', () => {
    expect(weightsFor('NONSENSE' as never)).toEqual(weightsFor('BALANCED'));
  });
});

describe('explanation', () => {
  it('describes the winner without inventing anything', () => {
    const ranked = rankRoutes(routeOptions('gulshan', 'mohammadpur', 18, 'working', 4), 'BALANCED');
    const text = explain(ranked, 'Balanced');
    expect(text).toContain('km');
    // while nothing is collected it must say so
    expect(text.toLowerCase()).toContain('modeled');
  });

  it('handles having no route at all', () => {
    expect(explain([], 'Balanced')).toMatch(/no route/i);
  });
});

describe('departure optimizer', () => {
  // a journey that is slow at 6 PM and quick by 9 PM
  const evaluate = (depart: number) => {
    const hour = Math.floor(depart / 60);
    const travel = hour >= 20 ? 30 : hour >= 19 ? 40 : 60;
    return { travelMinutes: travel, reliability: 80, score: 100 - travel };
  };

  it('only recommends a departure that arrives before the deadline', () => {
    const deadline = 21 * 60; // 9 PM
    const { best } = optimizeDeparture(deadline, 150, 15, 10, evaluate);
    expect(best).not.toBeNull();
    expect(best!.arriveAt).toBeLessThanOrEqual(deadline - 10);
  });

  it('marks options that cannot make it as not feasible', () => {
    const deadline = 21 * 60;
    const { options } = optimizeDeparture(deadline, 150, 15, 10, evaluate);
    const late = options.filter((o) => !o.feasible);
    for (const o of late) expect(o.arriveAt).toBeGreaterThan(deadline - 10);
  });

  it('returns nothing when the deadline cannot be met', () => {
    const impossible = () => ({ travelMinutes: 600, reliability: 50, score: 10 });
    const { best } = optimizeDeparture(20 * 60, 60, 15, 10, impossible);
    expect(best).toBeNull();
  });

  it('breaks a scoring tie by leaving as late as possible', () => {
    const flat = () => ({ travelMinutes: 20, reliability: 90, score: 50 });
    const deadline = 20 * 60;
    const { best } = optimizeDeparture(deadline, 120, 15, 10, flat);
    expect(best!.arriveAt).toBeLessThanOrEqual(deadline - 10);
    expect(best!.departAt).toBe(deadline - 30);
  });
});
