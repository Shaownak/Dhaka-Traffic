import { describe, expect, it } from 'vitest';
import { parseJourneyText, parseWithLlm } from './parse';
import { validateIntent } from './schema';

/** A fixed Tuesday, so "today" and "tomorrow" are reproducible. */
const NOW = new Date('2026-09-08T09:00:00');

describe('reading a journey out of a sentence', () => {
  it('handles the headline case end to end', () => {
    const result = parseJourneyText(
      'I want to leave Gulshan today at 5 PM, stop at a nice restaurant roughly halfway, '
      + 'and reach Mirpur as quickly as possible',
      NOW,
    );

    expect(result.ok).toBe(true);
    const r = result.request!;
    expect(r.origin).toBe('gulshan');
    expect(r.destination).toBe('mirpur10');
    expect(r.departAt).toBe(17 * 60);
    expect(r.date).toBe('2026-09-08');
    expect(r.preference).toBe('FASTEST');
    expect(r.stop?.position).toBe(0.5);
    expect(r.stop?.kinds).toContain('restaurant');
  });

  it('reads a deadline as an arrival, not a departure', () => {
    const r = parseJourneyText('I need to reach Mirpur from Gulshan before 7 PM', NOW).request!;
    expect(r.arriveBy).toBe(19 * 60);
    expect(r.departAt).toBeUndefined();
  });

  it('keeps a departure and a deadline apart when both are given', () => {
    const r = parseJourneyText(
      'leave Gulshan at 5 pm and reach Mirpur by 7 pm',
      NOW,
    ).request!;
    expect(r.departAt).toBe(17 * 60);
    expect(r.arriveBy).toBe(19 * 60);
  });

  it('does not mistake a place number for a time', () => {
    // "Mirpur 10" must not be read as ten o'clock
    const r = parseJourneyText('Gulshan to Mirpur 10 at 6 pm', NOW).request!;
    expect(r.departAt).toBe(18 * 60);
    expect(r.destination).toBe('mirpur10');
  });

  it('respects direction words over word order', () => {
    const r = parseJourneyText('I need to get to Gulshan, leaving from Mirpur', NOW).request!;
    expect(r.origin).toBe('mirpur10');
    expect(r.destination).toBe('gulshan');
  });

  it('understands 24-hour times', () => {
    const r = parseJourneyText('Gulshan to Mirpur at 17:30', NOW).request!;
    expect(r.departAt).toBe(17 * 60 + 30);
  });

  it('resolves tomorrow against the date it was given', () => {
    const r = parseJourneyText('Gulshan to Mirpur tomorrow at 9 am', NOW).request!;
    expect(r.date).toBe('2026-09-09');
  });

  it('picks up a cuisine only when it is one OSM actually tags', () => {
    const thai = parseJourneyText('Gulshan to Mirpur at 6pm, thai food halfway', NOW).request!;
    expect(thai.stop?.cuisine).toBe('thai');

    const vague = parseJourneyText('Gulshan to Mirpur at 6pm, nice food halfway', NOW).request!;
    expect(vague.stop?.cuisine).toBeUndefined();
  });

  it('reads how long they mean to stay', () => {
    const r = parseJourneyText(
      'Gulshan to Mirpur at 5pm, dinner halfway for 30 minutes',
      NOW,
    ).request!;
    expect(r.stop?.dwellMinutes).toBe(30);
  });

  it('places the stop where they asked, not always halfway', () => {
    const r = parseJourneyText(
      'Gulshan to Mirpur at 5pm with coffee near the end',
      NOW,
    ).request!;
    expect(r.stop?.position).toBe(0.7);
    expect(r.stop?.kinds).toEqual(['cafe']);
  });

  it('leaves the stop off when none was asked for', () => {
    const r = parseJourneyText('Gulshan to Mirpur at 5pm', NOW).request!;
    expect(r.stop ?? null).toBeNull();
  });

  it('is deterministic', () => {
    const text = 'leave Gulshan at 5 PM, eat halfway, reach Mirpur by 7';
    expect(parseJourneyText(text, NOW)).toEqual(parseJourneyText(text, NOW));
  });
});

describe('refusing what it cannot read', () => {
  it('says so when no place is recognised', () => {
    const result = parseJourneyText('take me somewhere nice', NOW);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/no place/i);
  });

  it('says so when only one place is recognised', () => {
    const result = parseJourneyText('I am going to Gulshan', NOW);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/two places|needs two/i);
  });

  it('rejects an empty string', () => {
    expect(parseJourneyText('', NOW).ok).toBe(false);
  });

  it('never invents a place that is not on the network', () => {
    // Chittagong is a real city and deliberately not in this graph
    const result = parseJourneyText('Gulshan to Chittagong at 5pm', NOW);
    if (result.ok) {
      expect(result.request!.destination).not.toBe('chittagong');
    } else {
      expect(result.problems.length).toBeGreaterThan(0);
    }
  });
});

describe('the intent schema', () => {
  const valid = { origin: 'gulshan', destination: 'mirpur10', date: '2026-09-08' };

  it('accepts a minimal intent', () => {
    expect(validateIntent(valid).ok).toBe(true);
  });

  it('rejects a field this system does not have', () => {
    // exactly what a model inventing traffic would produce
    const result = validateIntent({ ...valid, trafficConditions: 'heavy' });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/trafficConditions/);
  });

  it('rejects a made-up travel time', () => {
    const result = validateIntent({ ...valid, durationMinutes: 42 });
    expect(result.ok).toBe(false);
  });

  it('rejects coordinates, which a model must never supply', () => {
    const result = validateIntent({ ...valid, originLat: 23.78, originLon: 90.41 });
    expect(result.ok).toBe(false);
  });

  it('rejects an impossible clock time', () => {
    expect(validateIntent({ ...valid, departAt: 2000 }).ok).toBe(false);
    expect(validateIntent({ ...valid, departAt: -1 }).ok).toBe(false);
  });

  it('rejects a malformed date', () => {
    expect(validateIntent({ ...valid, date: '8th September' }).ok).toBe(false);
    expect(validateIntent({ ...valid, date: '2026-13-45' }).ok).toBe(false);
  });

  it('rejects a preference it does not offer', () => {
    expect(validateIntent({ ...valid, preference: 'SCENIC' }).ok).toBe(false);
  });

  it('rejects a stop kind it cannot search for', () => {
    const result = validateIntent({ ...valid, stop: { kinds: ['nightclub'], position: 0.5 } });
    expect(result.ok).toBe(false);
  });

  it('rejects a position outside the route', () => {
    expect(validateIntent({ ...valid, stop: { kinds: ['cafe'], position: 1.5 } }).ok).toBe(false);
  });

  it('reports every problem at once, not just the first', () => {
    const result = validateIntent({ origin: '', destination: '', date: 'nope' });
    expect(result.problems.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects things that are not objects at all', () => {
    for (const bad of [null, 'a sentence', 42, []]) {
      expect(validateIntent(bad).ok).toBe(false);
    }
  });
});

describe('the language-model seam', () => {
  const text = 'leave Gulshan at 5 pm and reach Mirpur by 7 pm';

  it('accepts a model reading that passes the schema', async () => {
    const result = await parseWithLlm(
      text,
      async () => ({ origin: 'gulshan', destination: 'mirpur10', date: '2026-09-08', departAt: 1020 }),
      NOW,
    );
    expect(result.ok).toBe(true);
    expect(result.request!.departAt).toBe(1020);
  });

  it('discards a model reading that invents a field, and falls back to rules', async () => {
    const result = await parseWithLlm(
      text,
      async () => ({
        origin: 'gulshan',
        destination: 'mirpur10',
        date: '2026-09-08',
        estimatedTravelTime: 95,
      }),
      NOW,
    );
    // the rule parser still produced a usable request
    expect(result.request?.origin).toBe('gulshan');
    expect(result.problems.join(' ')).toMatch(/rejected/);
  });

  it('falls back to rules when the model is unavailable', async () => {
    const result = await parseWithLlm(text, async () => { throw new Error('no key'); }, NOW);
    expect(result.ok).toBe(true);
    expect(result.problems.join(' ')).toMatch(/unavailable/);
  });
});
