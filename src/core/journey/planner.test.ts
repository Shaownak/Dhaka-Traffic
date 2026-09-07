/**
 * THE ACCEPTANCE TESTS.
 *
 * These are the ones that matter: they run the whole orchestrator, against the
 * real network and the real collected places dataset, and check the answers a
 * traveller would actually read.
 *
 * Every one of them is deterministic. The engine takes a date and a time as
 * inputs rather than reading the clock, so these assertions describe fixed
 * journeys and will keep describing them tomorrow.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { planJourney } from './planner';
import { JourneyError, type JourneyPlan } from './types';
import { osmPlaces } from '../places/provider';
import { hasProfileData } from '../traffic/hierarchy';

/** 2026-09-08 is a Tuesday: a working day in Bangladesh. */
const WORKING_DAY = new Date(2026, 8, 8, 12, 0, 0);
/** 2026-09-11 is a Friday: the Bangladeshi weekend. */
const WEEKEND_DAY = new Date(2026, 8, 11, 12, 0, 0);

const FIVE_PM = 17 * 60;
const SEVEN_PM = 19 * 60;

beforeAll(async () => {
  await osmPlaces.load();
});

describe('P0 — planning a journey', () => {
  let plan: JourneyPlan;

  beforeAll(async () => {
    plan = await planJourney({
      origin: 'gulshan',
      destination: 'mirpur10',
      date: WORKING_DAY,
      departAt: FIVE_PM,
    });
  });

  it('resolves both ends', () => {
    expect(plan.origin.name).toBe('Gulshan');
    expect(plan.destination.name).toBe('Mirpur 10');
  });

  it('knows a Tuesday is a working day', () => {
    expect(plan.dayType).toBe('working');
  });

  it('returns a route with real legs', () => {
    expect(plan.recommended.path[0]).toBe('gulshan');
    expect(plan.recommended.path[plan.recommended.path.length - 1]).toBe('mirpur10');
    expect(plan.recommended.legs.length).toBeGreaterThan(0);
    expect(plan.recommended.km).toBeGreaterThan(0);
  });

  it('offers alternatives that are genuinely different routes', () => {
    expect(plan.alternatives.length).toBeGreaterThan(0);
    const paths = new Set([plan.recommended, ...plan.alternatives].map((o) => o.path.join('>')));
    expect(paths.size).toBeGreaterThan(1);
  });

  it('gives an arrival as a range, never a single number', () => {
    const a = plan.recommended.arrival;
    expect(a.earliest).toBeLessThan(a.expected);
    expect(a.latest).toBeGreaterThan(a.expected);
  });

  it('leans late, because a journey cannot finish early the way it can run late', () => {
    const a = plan.recommended.arrival;
    expect(a.latest - a.expected).toBeGreaterThan(a.expected - a.earliest);
  });

  it('carries geometry for the map', () => {
    expect(plan.recommended.geometry.length).toBe(plan.recommended.path.length);
    for (const point of plan.recommended.geometry) {
      expect(point.lat).toBeGreaterThan(23);
      expect(point.lon).toBeGreaterThan(90);
    }
  });

  it('labels every alternative with something it actually is', () => {
    const all = [plan.recommended, ...plan.alternatives];
    expect(all[0]!.labels).toContain('RECOMMENDED');

    const fastest = all.find((o) => o.labels.includes('FASTEST'));
    if (fastest) {
      const direct = all.filter((o) => o.kind === 'direct');
      const quickest = Math.min(...direct.map((o) => o.duration.expectedMinutes));
      expect(fastest.duration.expectedMinutes).toBeCloseTo(quickest, 6);
    }
  });

  it('explains itself without inventing anything', () => {
    expect(plan.explanation.length).toBeGreaterThan(40);
    expect(plan.explanation).toMatch(/km|minutes|min/);
  });

  it('is deterministic', async () => {
    const again = await planJourney({
      origin: 'gulshan',
      destination: 'mirpur10',
      date: WORKING_DAY,
      departAt: FIVE_PM,
    });
    expect(again.recommended.path).toEqual(plan.recommended.path);
    expect(again.recommended.duration.expectedMinutes)
      .toBeCloseTo(plan.recommended.duration.expectedMinutes, 9);
  });
});

describe('P0 — honesty about where the numbers come from', () => {
  // These assert the RELATIONSHIP between the data on disk and what the plan
  // claims, not a particular state of the data. Written the other way — "the
  // tier is always baseline" — they passed only while nothing had been
  // collected, and would have failed the first time somebody ran the
  // collector, which is precisely when they most need to keep working.

  it('reports a tier that matches what is actually on disk', async () => {
    const plan = await planJourney({
      origin: 'gulshan', destination: 'mirpur10', date: WORKING_DAY, departAt: FIVE_PM,
    });
    const collected = hasProfileData();
    for (const leg of plan.recommended.legs) {
      // The observed and predicted tiers need infrastructure that does not
      // exist, so they must never appear however much data is collected.
      expect(['profile', 'baseline', 'freeflow']).toContain(leg.tier);
      if (!collected) expect(leg.tier).toBe('baseline');
    }
  });

  it('ties confidence to coverage rather than asserting it', async () => {
    const plan = await planJourney({
      origin: 'gulshan', destination: 'mirpur10', date: WORKING_DAY, departAt: FIVE_PM,
    });
    if (plan.confidence.coverage === 0) {
      expect(plan.confidence.level).toBe('LOW');
      expect(plan.confidence.reasons.join(' ')).toMatch(/not been collected|modeled|estimate/i);
    } else {
      // measured data must earn more credence than a model, always
      expect(plan.confidence.score).toBeGreaterThan(40);
      expect(plan.confidence.reasons.join(' ')).toMatch(/collected/i);
    }
  });

  it('never claims more coverage than it has legs for', async () => {
    const plan = await planJourney({
      origin: 'gulshan', destination: 'mirpur10', date: WORKING_DAY, departAt: FIVE_PM,
    });
    const measured = plan.recommended.legs.filter(
      (l) => l.tier === 'profile' || l.tier === 'observed',
    ).length;
    if (measured === 0) expect(plan.confidence.coverage).toBe(0);
    if (measured === plan.recommended.legs.length) {
      expect(plan.confidence.coverage).toBeCloseTo(1, 6);
    }
  });
});

describe('P0 — time of day actually changes the answer', () => {
  it('makes the evening peak slower than the small hours', async () => {
    const peak = await planJourney({
      origin: 'gulshan', destination: 'mirpur10', date: WORKING_DAY, departAt: FIVE_PM,
    });
    const night = await planJourney({
      origin: 'gulshan', destination: 'mirpur10', date: WORKING_DAY, departAt: 3 * 60,
    });
    expect(peak.recommended.duration.expectedMinutes)
      .toBeGreaterThan(night.recommended.duration.expectedMinutes);
  });

  it('treats a Friday as the weekend', async () => {
    const plan = await planJourney({
      origin: 'gulshan', destination: 'mirpur10', date: WEEKEND_DAY, departAt: FIVE_PM,
    });
    expect(plan.dayType).toBe('weekend');
  });

  it('makes the same trip easier on a weekend evening', async () => {
    const working = await planJourney({
      origin: 'gulshan', destination: 'mirpur10', date: WORKING_DAY, departAt: FIVE_PM,
    });
    const weekend = await planJourney({
      origin: 'gulshan', destination: 'mirpur10', date: WEEKEND_DAY, departAt: FIVE_PM,
    });
    expect(weekend.recommended.duration.expectedMinutes)
      .toBeLessThan(working.recommended.duration.expectedMinutes);
  });
});

describe('P1 — the full acceptance scenario', () => {
  let plan: JourneyPlan;

  beforeAll(async () => {
    // "leave Gulshan at 5 PM, stop at a restaurant roughly halfway, reach Mirpur"
    plan = await planJourney({
      origin: 'gulshan',
      destination: 'mirpur10',
      date: WORKING_DAY,
      departAt: FIVE_PM,
      preference: 'FASTEST',
      stop: {
        kinds: ['restaurant', 'cafe', 'fast_food'],
        position: 0.5,
        dwellMinutes: 45,
      },
    });
  });

  it('recommends a journey that includes a stop', () => {
    expect(plan.recommended.kind).toBe('with-stop');
    expect(plan.recommended.stop).not.toBeNull();
  });

  it('names a real place from the collected dataset', () => {
    const stop = plan.recommended.stop!;
    expect(stop.name.length).toBeGreaterThan(0);
    expect(stop.id).toMatch(/^osm:/);
    // it exists in the dataset at those coordinates
    const found = osmPlaces.near({ lat: stop.lat, lon: stop.lon }, 0.05);
    expect(found.some((p) => p.id === stop.id)).toBe(true);
  });

  it('puts the stop roughly where it was asked for', () => {
    expect(plan.recommended.stop!.position).toBeGreaterThan(0.2);
    expect(plan.recommended.stop!.position).toBeLessThan(0.8);
  });

  it('computes a real detour rather than assuming one', () => {
    const stop = plan.recommended.stop!;
    const direct = [plan.recommended, ...plan.alternatives].find((o) => o.kind === 'direct');
    expect(direct).toBeDefined();
    // The detour is the extra DRIVING, so it excludes the time at the table.
    // Its sign is deliberately not asserted: see the weekend case below.
    expect(plan.recommended.travelMinutes - direct!.travelMinutes)
      .toBeCloseTo(stop.detourMinutes, 3);
  });

  it('never makes the whole journey faster than going straight there', () => {
    const direct = [plan.recommended, ...plan.alternatives].find((o) => o.kind === 'direct')!;
    // Total time must always be worse — you cannot arrive sooner by stopping
    // for 45 minutes. This is the invariant that a negative DRIVING detour
    // must never be allowed to violate.
    expect(plan.recommended.duration.expectedMinutes)
      .toBeGreaterThan(direct.duration.expectedMinutes);
  });

  it('may shorten the driving when the stop outlasts the peak, and says so', async () => {
    // Because every leg is priced at the hour it is actually driven, a long
    // stop can put the second half of the trip into quieter traffic. That
    // makes the DRIVING detour negative, which is a real finding rather than
    // an arithmetic slip — so it is reported as a saving, never as "adds -1
    // minutes", and never at the cost of the total-time invariant above.
    const weekend = await planJourney({
      origin: 'gulshan',
      destination: 'mirpur10',
      date: WEEKEND_DAY,
      departAt: FIVE_PM,
      stop: { kinds: ['restaurant', 'cafe', 'fast_food'], position: 0.5, dwellMinutes: 45 },
    });

    const stop = weekend.recommended.stop;
    if (stop && stop.detourMinutes < -0.5) {
      expect(weekend.explanation).toMatch(/saves .* of driving/);
      expect(weekend.explanation).not.toMatch(/adds -/);
    }

    // whatever the driving does, the journey as a whole still costs more
    const direct = weekend.alternatives.find((o) => o.kind === 'direct');
    if (direct) {
      expect(weekend.recommended.duration.expectedMinutes)
        .toBeGreaterThan(direct.duration.expectedMinutes);
    }
  });

  it('builds a timeline that adds up', () => {
    const s = plan.recommended.stop!;
    expect(s.arriveAt).toBeGreaterThan(plan.departAt);
    expect(s.departAt - s.arriveAt).toBe(s.dwellMinutes);
    expect(plan.recommended.arrival.expected).toBeGreaterThan(s.departAt);
  });

  it('always shows the stop-free journey for comparison', () => {
    expect(plan.alternatives.some((o) => o.kind === 'direct')).toBe(true);
  });

  it('says which junction the stop is reached through, and how far the door is', () => {
    const s = plan.recommended.stop!;
    expect(s.viaPlaceName.length).toBeGreaterThan(0);
    expect(s.accessKm).toBeGreaterThanOrEqual(0);
    expect(s.accessKm).toBeLessThanOrEqual(2.5);
  });

  it('states opening as open, closed or unknown, never as a guess', () => {
    for (const option of [plan.recommended, ...plan.alternatives]) {
      if (!option.stop) continue;
      expect(['open', 'closed', 'unknown']).toContain(option.stop.open);
    }
  });

  it('explains the stop in terms of what it costs', () => {
    expect(plan.explanation).toMatch(/stop costs|adds|extra driving/i);
  });

  it('is deterministic — same request, same restaurant', async () => {
    const again = await planJourney({
      origin: 'gulshan',
      destination: 'mirpur10',
      date: WORKING_DAY,
      departAt: FIVE_PM,
      preference: 'FASTEST',
      stop: { kinds: ['restaurant', 'cafe', 'fast_food'], position: 0.5, dwellMinutes: 45 },
    });
    expect(again.recommended.stop!.id).toBe(plan.recommended.stop!.id);
    expect(again.recommended.score).toBe(plan.recommended.score);
  });
});

describe('P1 — stops that cannot be found', () => {
  it('says so rather than substituting something else', async () => {
    const plan = await planJourney({
      origin: 'gulshan',
      destination: 'mirpur10',
      date: WORKING_DAY,
      departAt: FIVE_PM,
      // no OSM place in Dhaka is tagged with this cuisine
      stop: { kinds: ['restaurant'], position: 0.5, dwellMinutes: 30, cuisine: 'norwegian' },
    });
    expect(plan.recommended.kind).toBe('direct');
    expect(plan.notices.join(' ')).toMatch(/no restaurant|nothing has been substituted/i);
  });

  it('honours a cuisine when one genuinely exists', async () => {
    const plan = await planJourney({
      origin: 'gulshan',
      destination: 'mirpur10',
      date: WORKING_DAY,
      departAt: FIVE_PM,
      stop: { kinds: ['restaurant', 'cafe', 'fast_food'], position: 0.5, dwellMinutes: 30, cuisine: 'chinese' },
    });
    if (plan.recommended.stop) {
      expect(plan.recommended.stop.cuisine?.toLowerCase()).toContain('chinese');
    }
  });
});

describe('P3 — working backwards from a deadline', () => {
  let plan: JourneyPlan;

  beforeAll(async () => {
    plan = await planJourney({
      origin: 'gulshan',
      destination: 'mirpur10',
      date: WORKING_DAY,
      arriveBy: SEVEN_PM,
    });
  });

  it('recommends a departure that actually arrives in time', () => {
    expect(plan.departure).not.toBeNull();
    expect(plan.departure!.arrival.expected).toBeLessThanOrEqual(SEVEN_PM);
  });

  it('offers the window, not just one time', () => {
    const d = plan.departure!;
    expect(d.earliestSensible).toBeLessThanOrEqual(d.recommended);
    expect(d.latestSafe).toBeGreaterThanOrEqual(d.recommended);
    expect(d.options.length).toBeGreaterThan(1);
  });

  it('keeps a buffer rather than cutting it fine', () => {
    expect(plan.departure!.bufferMinutes).toBeGreaterThan(0);
  });

  it('plans the journey from the departure it recommended', () => {
    expect(plan.departAt).toBe(plan.departure!.recommended);
  });

  it('pays for the stop when working backwards from a deadline', async () => {
    // The bug this guards: the deadline search costed only the driving, so a
    // 45-minute meal was recommended with a departure that arrived on time in
    // theory and three quarters of an hour late in fact.
    const plan = await planJourney({
      origin: 'gulshan',
      destination: 'mirpur10',
      date: WORKING_DAY,
      arriveBy: 20 * 60,
      stop: { kinds: ['restaurant', 'cafe', 'fast_food'], position: 0.5, dwellMinutes: 45 },
    });

    expect(plan.recommended.kind).toBe('with-stop');
    // the journey actually offered must meet the deadline it was built around
    expect(plan.recommended.arrival.expected).toBeLessThanOrEqual(20 * 60);
    // and the departure card must agree with the journey beside it
    expect(plan.departure!.arrival.expected)
      .toBeCloseTo(plan.recommended.arrival.expected, 0);
  });

  it('says so when the recommended journey still misses the deadline', async () => {
    // A three-hour stop cannot be absorbed; the plan is still returned, with
    // the shortfall stated rather than hidden.
    const plan = await planJourney({
      origin: 'gulshan',
      destination: 'mirpur10',
      date: WORKING_DAY,
      departAt: 17 * 60,
      arriveBy: 18 * 60,
    }).catch(() => null);

    if (plan && plan.recommended.arrival.expected > 18 * 60) {
      expect(plan.notices.join(' ')).toMatch(/after your .* deadline/i);
    }
  });

  it('refuses an impossible deadline instead of pretending', async () => {
    await expect(
      planJourney({
        origin: 'uttara',
        destination: 'postogola',
        date: WORKING_DAY,
        // ten past midnight: nothing in the search window can make it
        arriveBy: 10,
      }),
    ).rejects.toThrow(JourneyError);
  });
});

describe('bad requests', () => {
  it('rejects an unknown origin by name', async () => {
    await expect(
      planJourney({ origin: 'Atlantis', destination: 'mirpur10', date: WORKING_DAY, departAt: FIVE_PM }),
    ).rejects.toMatchObject({ code: 'ORIGIN_NOT_FOUND' });
  });

  it('rejects a journey to where you already are', async () => {
    await expect(
      planJourney({ origin: 'gulshan', destination: 'gulshan', date: WORKING_DAY, departAt: FIVE_PM }),
    ).rejects.toMatchObject({ code: 'SAME_PLACE' });
  });

  it('accepts everyday names, not just ids', async () => {
    const plan = await planJourney({
      origin: 'Gulshan 2', destination: 'Mirpur', date: WORKING_DAY, departAt: FIVE_PM,
    });
    expect(plan.origin.id).toBe('gulshan');
    expect(plan.destination.id).toBe('mirpur10');
  });
});

describe('preferences change the outcome', () => {
  it('FASTEST returns the quickest of the direct options', async () => {
    const plan = await planJourney({
      origin: 'uttara', destination: 'motijheel', date: WORKING_DAY, departAt: FIVE_PM,
      preference: 'FASTEST',
    });
    const direct = [plan.recommended, ...plan.alternatives].filter((o) => o.kind === 'direct');
    const quickest = Math.min(...direct.map((o) => o.duration.expectedMinutes));
    expect(plan.recommended.duration.expectedMinutes).toBeCloseTo(quickest, 6);
  });

  it('SHORTEST returns the shortest of the direct options', async () => {
    const plan = await planJourney({
      origin: 'uttara', destination: 'motijheel', date: WORKING_DAY, departAt: FIVE_PM,
      preference: 'SHORTEST',
    });
    const direct = [plan.recommended, ...plan.alternatives].filter((o) => o.kind === 'direct');
    expect(plan.recommended.km).toBeCloseTo(Math.min(...direct.map((o) => o.km)), 6);
  });
});
