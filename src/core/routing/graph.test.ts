import { describe, expect, it } from 'vitest';
import { PLACES, ROADS } from '../../data/network';
import {
  bestDeparture,
  dayTypeOf,
  departureCurve,
  fastestRoute,
  placeName,
  roadSpeed,
  routeOptions,
} from './graph';

const road = (a: string, b: string) =>
  ROADS.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))!;

describe('the network itself', () => {
  it('has no road pointing at a place that does not exist', () => {
    const ids = new Set(PLACES.map((p) => p.id));
    for (const r of ROADS) {
      expect(ids.has(r.a), `road from ${r.a}`).toBe(true);
      expect(ids.has(r.b), `road to ${r.b}`).toBe(true);
    }
  });

  it('leaves no place stranded', () => {
    for (const p of PLACES) {
      const connected = ROADS.some((r) => r.a === p.id || r.b === p.id);
      expect(connected, `${p.id} has no road`).toBe(true);
    }
  });

  it('connects every place to every other place', () => {
    // a router that cannot answer a question is worse than a slow answer
    for (const from of PLACES) {
      for (const to of PLACES) {
        if (from.id === to.id) continue;
        const r = fastestRoute(from.id, to.id, 18, 'working');
        expect(r, `${from.id} -> ${to.id}`).not.toBeNull();
      }
    }
  });

  it('never has a peak speed above its free-flow speed', () => {
    for (const r of ROADS) expect(r.peakKmh).toBeLessThanOrEqual(r.freeKmh);
  });
});

describe('roadSpeed', () => {
  const gb = road('gulshan', 'badda');

  it('sits at the peak speed in the worst hour and free-flow in the best', () => {
    expect(roadSpeed(gb, 18, 'working')).toBeCloseTo(gb.peakKmh, 5);
    expect(roadSpeed(gb, 2, 'working')).toBeCloseTo(gb.freeKmh, 5);
  });

  it('runs faster on a weekend at commuting hours', () => {
    expect(roadSpeed(gb, 9, 'weekend')).toBeGreaterThan(roadSpeed(gb, 9, 'working'));
    expect(roadSpeed(gb, 18, 'weekend')).toBeGreaterThan(roadSpeed(gb, 18, 'working'));
  });

  it('never exceeds free-flow, whatever the day', () => {
    for (let h = 0; h < 24; h++) {
      for (const d of ['working', 'weekend'] as const) {
        expect(roadSpeed(gb, h, d)).toBeLessThanOrEqual(gb.freeKmh + 1e-9);
        expect(roadSpeed(gb, h, d)).toBeGreaterThan(0);
      }
    }
  });
});

describe('dayTypeOf', () => {
  it('treats Friday and Saturday as the weekend', () => {
    // 4 and 5 September 2026 are a Friday and a Saturday
    expect(dayTypeOf(new Date('2026-09-04T12:00:00'))).toBe('weekend');
    expect(dayTypeOf(new Date('2026-09-05T12:00:00'))).toBe('weekend');
    expect(dayTypeOf(new Date('2026-09-06T12:00:00'))).toBe('working');
    expect(dayTypeOf(new Date('2026-09-03T12:00:00'))).toBe('working');
  });
});

describe('fastestRoute', () => {
  it('starts at the origin and ends at the destination', () => {
    const r = fastestRoute('gulshan', 'mohammadpur', 18, 'working')!;
    expect(r.path[0]).toBe('gulshan');
    expect(r.path[r.path.length - 1]).toBe('mohammadpur');
  });

  it('is no slower than any alternative it is offered', () => {
    const best = fastestRoute('gulshan', 'mohammadpur', 18, 'working')!;
    for (const alt of routeOptions('gulshan', 'mohammadpur', 18, 'working', 4)) {
      expect(best.minutes).toBeLessThanOrEqual(alt.minutes + 1e-6);
    }
  });

  it('adds its legs up to its total', () => {
    const r = fastestRoute('uttara', 'motijheel', 18, 'working')!;
    const summed = r.legs.reduce((s, l) => s + l.minutes, 0);
    expect(r.minutes).toBeCloseTo(summed, 6);
    expect(r.km).toBeCloseTo(r.legs.reduce((s, l) => s + l.km, 0), 6);
  });

  it('reports delay as the gap from a clear road, never negative', () => {
    for (const h of [3, 9, 13, 18, 22]) {
      const r = fastestRoute('uttara', 'motijheel', h, 'working')!;
      expect(r.delayMinutes).toBeCloseTo(r.minutes - r.freeFlowMinutes, 6);
      expect(r.delayMinutes).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('takes longer at the evening peak than at three in the morning', () => {
    const peak = fastestRoute('gulshan', 'mohammadpur', 18, 'working')!;
    const night = fastestRoute('gulshan', 'mohammadpur', 3, 'working')!;
    expect(peak.minutes).toBeGreaterThan(night.minutes * 1.5);
  });

  it('refuses a trip to nowhere', () => {
    expect(fastestRoute('gulshan', 'gulshan', 18, 'working')).toBeNull();
    expect(fastestRoute('gulshan', 'atlantis', 18, 'working')).toBeNull();
  });
});

describe('routeOptions', () => {
  it('offers distinct alternatives, ordered fastest first', () => {
    const opts = routeOptions('gulshan', 'mohammadpur', 18, 'working', 4);
    expect(opts.length).toBeGreaterThan(1);
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i]!.minutes).toBeGreaterThanOrEqual(opts[i - 1]!.minutes);
    }
    const signatures = opts.map((o) => o.path.join('>'));
    expect(new Set(signatures).size).toBe(signatures.length);
  });
});

describe('departureCurve', () => {
  it('covers every hour asked for', () => {
    const curve = departureCurve('gulshan', 'mohammadpur', 16, 21, 'working');
    expect(curve.map((p) => p.hour)).toEqual([16, 17, 18, 19, 20, 21]);
  });

  it('finds the cheapest hour to leave', () => {
    const curve = departureCurve('gulshan', 'mohammadpur', 16, 21, 'working');
    const best = bestDeparture(curve)!;
    for (const p of curve) expect(best.minutes).toBeLessThanOrEqual(p.minutes);
  });

  it('is cheaper across a weekend evening than a working one', () => {
    const work = departureCurve('gulshan', 'mohammadpur', 16, 21, 'working');
    const weekend = departureCurve('gulshan', 'mohammadpur', 16, 21, 'weekend');
    expect(bestDeparture(weekend)!.minutes).toBeLessThan(bestDeparture(work)!.minutes);
  });
});

describe('placeName', () => {
  it('resolves ids and falls back to the id', () => {
    expect(placeName('mohammadpur')).toBe('Mohammadpur');
    expect(placeName('nowhere')).toBe('nowhere');
  });
});
