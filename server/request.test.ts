/**
 * The API's request-shaping layer.
 *
 * Most of these guard one specific regression. The shaping layer used to copy
 * the fields it recognised into a fresh object and validate that — so unknown
 * keys never reached the validator, and a caller sending
 * `"trafficConditions": "heavy"` got a plan back as though the field had been
 * honoured. The strict schema was intact the whole time; the layer above it was
 * quietly discarding exactly what the schema existed to reject.
 *
 * That is the failure mode worth testing: not "does the validator work" but
 * "does anything reach the validator".
 */
import { describe, expect, it } from 'vitest';
import { dateFrom, isoToday, toJourneyRequest } from './request';

const NOW = new Date(2026, 8, 8, 9, 0, 0); // Tuesday 8 September 2026

const valid = { origin: 'gulshan', destination: 'mirpur10', date: '2026-09-08' };

describe('shaping a structured body', () => {
  it('accepts a minimal request', () => {
    const result = toJourneyRequest(valid, NOW);
    expect('request' in result).toBe(true);
    if ('request' in result) {
      expect(result.request.origin).toBe('gulshan');
      expect(result.request.destination).toBe('mirpur10');
    }
  });

  it('defaults the date to today when none is given', () => {
    const result = toJourneyRequest({ origin: 'gulshan', destination: 'mirpur10' }, NOW);
    expect('request' in result).toBe(true);
    if ('request' in result) {
      expect(result.request.date.getFullYear()).toBe(2026);
      expect(result.request.date.getMonth()).toBe(8);
      expect(result.request.date.getDate()).toBe(8);
    }
  });

  it('carries departure, deadline and preference through', () => {
    const result = toJourneyRequest(
      { ...valid, departAt: 1020, arriveBy: 1200, preference: 'FASTEST' },
      NOW,
    );
    if (!('request' in result)) throw new Error(result.problems.join('; '));
    expect(result.request.departAt).toBe(1020);
    expect(result.request.arriveBy).toBe(1200);
    expect(result.request.preference).toBe('FASTEST');
  });

  it('clamps the alternatives count instead of trusting it', () => {
    for (const [given, expected] of [[99, 8], [0, 1], [-3, 1], [3, 3]] as const) {
      const result = toJourneyRequest({ ...valid, alternatives: given }, NOW);
      if (!('request' in result)) throw new Error('rejected a valid body');
      expect(result.request.alternatives).toBe(expected);
    }
  });
});

describe('unknown fields reach the validator and are rejected', () => {
  // Each of these is something a language model might plausibly emit. All of
  // them must fail loudly rather than be silently dropped.
  const invented: [string, Record<string, unknown>][] = [
    ['traffic', { trafficConditions: 'heavy' }],
    ['a travel time', { durationMinutes: 42 }],
    ['coordinates', { originLat: 23.78, originLon: 90.41 }],
    ['a distance', { distanceKm: 13.2 }],
    ['a road closure', { closures: ['Bijoy Sarani'] }],
    ['a route', { route: ['gulshan', 'mirpur10'] }],
    ['a made-up restaurant', { restaurant: 'The Blue Door' }],
  ];

  for (const [what, extra] of invented) {
    it(`rejects ${what}`, () => {
      const result = toJourneyRequest({ ...valid, ...extra }, NOW);
      expect('problems' in result, `${what} was accepted`).toBe(true);
      if ('problems' in result) {
        const key = Object.keys(extra)[0]!;
        expect(result.problems.join(' ')).toContain(key);
      }
    });
  }

  it('rejects an out-of-range clock time', () => {
    expect('problems' in toJourneyRequest({ ...valid, departAt: 5000 }, NOW)).toBe(true);
  });

  it('rejects a preference it does not offer', () => {
    expect('problems' in toJourneyRequest({ ...valid, preference: 'SCENIC' }, NOW)).toBe(true);
  });

  it('rejects a stop kind it cannot search for', () => {
    const result = toJourneyRequest(
      { ...valid, stop: { kinds: ['nightclub'], position: 0.5, dwellMinutes: 30 } },
      NOW,
    );
    expect('problems' in result).toBe(true);
  });

  it('does not treat transport fields as invented ones', () => {
    // `alternatives` and `text` belong to the API, not the intent, and must
    // not be reported as unknown intent fields
    const result = toJourneyRequest({ ...valid, alternatives: 3 }, NOW);
    expect('request' in result).toBe(true);
  });
});

describe('shaping a sentence', () => {
  it('reads a sentence into the same request shape', () => {
    const result = toJourneyRequest(
      { text: 'leave Gulshan at 5 PM, eat halfway, reach Mirpur by 8 PM' },
      NOW,
    );
    if (!('request' in result)) throw new Error(result.problems.join('; '));
    expect(result.request.origin).toBe('gulshan');
    expect(result.request.destination).toBe('mirpur10');
    expect(result.request.arriveBy).toBe(20 * 60);
    expect(result.request.stop).toBeTruthy();
  });

  it('reports why a sentence could not be read', () => {
    const result = toJourneyRequest({ text: 'take me somewhere nice' }, NOW);
    expect('problems' in result).toBe(true);
  });

  it('ignores structured fields when a sentence is given', () => {
    // the sentence wins; it is what the caller asked to be read
    const result = toJourneyRequest(
      { text: 'Gulshan to Mirpur at 6 pm', origin: 'uttara', destination: 'motijheel' },
      NOW,
    );
    if (!('request' in result)) throw new Error('rejected');
    expect(result.request.origin).toBe('gulshan');
  });
});

describe('dates', () => {
  it('parses an ISO date at midday so no timezone can shift the day', () => {
    expect(dateFrom('2026-09-08', NOW).getDate()).toBe(8);
    expect(dateFrom('2026-09-08', NOW).getHours()).toBe(12);
  });

  it('falls back to now for anything unparseable', () => {
    expect(dateFrom('8th September', NOW)).toEqual(NOW);
    expect(dateFrom(undefined, NOW)).toEqual(NOW);
    expect(dateFrom(12345, NOW)).toEqual(NOW);
  });

  it('formats today as an ISO date', () => {
    expect(isoToday(NOW)).toBe('2026-09-08');
  });
});
