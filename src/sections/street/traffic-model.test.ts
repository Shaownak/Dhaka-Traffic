import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CORRIDORS, HOURLY_SPEED_KMH } from '../../data/traffic';
import {
  KINDS,
  MODEL,
  TrafficModel,
  corridorConditions,
  spacingFor,
} from './traffic-model';

/** A deterministic stand-in for Math.random. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Never triggers the random brake tap; picks the same kind every time. */
const steady = (): number => 0.5;

describe('corridorConditions', () => {
  const worst = HOURLY_SPEED_KMH.indexOf(Math.min(...HOURLY_SPEED_KMH));
  const best = HOURLY_SPEED_KMH.indexOf(Math.max(...HOURLY_SPEED_KMH));

  it('runs at the corridor peak speed in the worst hour of the day', () => {
    const { kmh, t } = corridorConditions(0, worst);
    expect(t).toBe(0);
    expect(kmh).toBeCloseTo(CORRIDORS[0]!.peak, 6);
  });

  it('runs at the corridor free-flow speed in the best hour', () => {
    const { kmh, t } = corridorConditions(0, best);
    expect(t).toBe(1);
    expect(kmh).toBeCloseTo(CORRIDORS[0]!.free, 6);
  });

  it('falls back to the first corridor rather than throwing', () => {
    expect(corridorConditions(99, 12)).toEqual(corridorConditions(0, 12));
  });

  it('reduces speed significantly under rain condition', () => {
    const dry = corridorConditions(0, 12, false);
    const wet = corridorConditions(0, 12, true);
    expect(wet.kmh).toBeLessThan(dry.kmh);
  });
});

describe('spacingFor', () => {
  it('packs vehicles tighter on a slower road', () => {
    expect(spacingFor(4)).toBeLessThan(spacingFor(32));
  });
});

describe('populate', () => {
  it('fills six lanes, three each way', () => {
    const m = new TrafficModel({ rng: seeded(1) });
    expect(m.lanes).toHaveLength(6);
    expect(m.lanes.filter((l) => l.dir === 1)).toHaveLength(3);
    expect(m.lanes.map((l) => l.z)).toEqual([2.4, 6, 9.6, -2.4, -6, -9.6]);
  });

  it('keeps every vehicle on the road and within the lane limits', () => {
    const m = new TrafficModel({ rng: seeded(7) });
    m.populate(4, spacingFor(4));
    for (const lane of m.lanes) {
      expect(lane.cars.length).toBeGreaterThanOrEqual(3);
      expect(lane.cars.length).toBeLessThanOrEqual(36);
      for (const c of lane.cars) {
        expect(c.s).toBeGreaterThanOrEqual(0);
        expect(c.s).toBeLessThan(m.roadLength);
        expect(KINDS).toContain(c.kind);
      }
    }
  });

  it('puts more vehicles on the road at the worst hour than at the best', () => {
    const peak = new TrafficModel({ rng: seeded(3) });
    peak.populate(4, spacingFor(4));
    const quiet = new TrafficModel({ rng: seeded(3) });
    quiet.populate(32, spacingFor(32));
    expect(peak.vehicleCount).toBeGreaterThan(quiet.vehicleCount);
  });
});

describe('step', () => {
  it('never lets a vehicle reverse or exceed its own top speed', () => {
    const m = new TrafficModel({ rng: seeded(11) });
    m.populate(9, spacingFor(9));
    for (let i = 0; i < 600; i++) m.step(1 / 60);
    for (const lane of m.lanes) {
      for (const c of lane.cars) {
        expect(c.v).toBeGreaterThanOrEqual(0);
        expect(c.v).toBeLessThanOrEqual(c.vmax + 1e-9);
        expect(c.s).toBeGreaterThanOrEqual(0);
        expect(c.s).toBeLessThan(m.roadLength);
      }
    }
  });

  it('respects the acceleration limit', () => {
    const m = new TrafficModel({ rng: steady, roadLength: 1000 });
    m.populate(30, 500);
    const before = m.lanes[0]!.cars.map((c) => c.v);
    const dt = 1 / 60;
    m.step(dt);
    m.lanes[0]!.cars.forEach((c, i) => {
      expect(Math.abs(c.v - before[i]!)).toBeLessThanOrEqual(MODEL.accel * dt + 1e-9);
    });
  });

  it('accelerates to the driver top speed on an empty road', () => {
    const m = new TrafficModel({ rng: steady, roadLength: 1000 });
    m.populate(30, 500);
    for (let i = 0; i < 60 * 30; i++) m.step(1 / 60);
    for (const c of m.lanes[0]!.cars) expect(c.v).toBeCloseTo(c.vmax, 3);
  });

  it('stops behind a stopped vehicle instead of driving through it', () => {
    const m = new TrafficModel({ rng: steady });
    const kind = KINDS[0]!;
    const lane = m.lanes[0]!;
    // one stationary vehicle, one arriving behind it at speed
    lane.cars = [
      { s: 0, v: 8, vmax: 8, kind, color: 0 },
      { s: 40, v: 0, vmax: 0, kind, color: 0 },
    ];
    for (let i = 0; i < 60 * 20; i++) m.step(1 / 60);
    const follower = lane.cars[0]!;
    const leader = lane.cars[1]!;
    expect(leader.s).toBe(40); // the leader has not moved
    expect(follower.v).toBeLessThan(0.01);
    const gap = leader.s - follower.s - leader.kind.len;
    expect(gap).toBeGreaterThan(-MODEL.minGap);
    expect(gap).toBeLessThan(MODEL.minGap + 1);
  });

  it('produces a spread of speeds under load — the queues are emergent', () => {
    const m = new TrafficModel({ rng: seeded(23) });
    m.populate(4, spacingFor(4));
    for (let i = 0; i < 60 * 20; i++) m.step(1 / 60);
    const speeds = m.lanes.flatMap((l) => l.cars.map((c) => c.v));
    const slowest = Math.min(...speeds);
    const fastest = Math.max(...speeds);
    // if every vehicle moved at the same speed the model would be an animation
    expect(fastest - slowest).toBeGreaterThan(0.05);
    expect(m.meanSpeed).toBeLessThanOrEqual(fastest);
  });
});

describe('placements', () => {
  it('centers the road on the origin and never exceeds the instance cap', () => {
    const m = new TrafficModel({ rng: seeded(5) });
    m.populate(4, spacingFor(4));
    const all = [...m.placements(40)];
    expect(all).toHaveLength(40);
    for (const p of all) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(m.roadLength / 2 + 1e-9);
      expect(Math.abs(p.dir)).toBe(1);
    }
  });
});

describe('module boundaries', () => {
  it('does not import Three', () => {
    const src = readFileSync(new URL('./traffic-model.ts', import.meta.url), 'utf8');
    expect(/from\s+['"]three/.test(src)).toBe(false);
  });
});

describe('a corridor actually runs at the speed it claims', () => {
  // The bug this pins: density used to be a function of the hour alone, so
  // every corridor was packed identically and the car-following rule capped
  // them all at the same crawl. Selecting a faster road changed the readout
  // and nothing else.
  const settle = (kmh: number): TrafficModel => {
    const m = new TrafficModel({ rng: seeded(19) });
    m.populate(kmh, spacingFor(kmh));
    for (let i = 0; i < 60 * 40; i++) m.step(1 / 60);
    return m;
  };

  it('holds close to the target speed once settled', () => {
    for (const kmh of [4, 8, 14, 32]) {
      const achieved = settle(kmh).meanSpeed * 3.6;
      // within 20 percent: the random brake tap costs a little, by design
      expect(Math.abs(achieved - kmh) / kmh).toBeLessThan(0.2);
    }
  });

  it('puts fewer vehicles on a faster road', () => {
    const slow = settle(4).vehicleCount;
    const fast = settle(14).vehicleCount;
    expect(fast).toBeLessThan(slow);
  });

  it('separates the corridors, not just their labels', () => {
    const slow = settle(4).meanSpeed;
    const fast = settle(14).meanSpeed;
    // the whole point: a 3.5x faster corridor must visibly move faster
    expect(fast / slow).toBeGreaterThan(2.5);
  });
});
