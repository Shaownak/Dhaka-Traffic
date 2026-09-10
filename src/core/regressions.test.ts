import { describe, expect, it } from 'vitest';
import { planJourney } from './journey/planner';
import { parseJourneyText } from './nl/parse';
import { validateIntent } from './nl/schema';
import { isOpenAt } from './places/opening-hours';
import { applyIntent, form, requestFromState } from '../sections/trip/state';
import { toJourneyRequest } from '../../server/request';
import { estimateFromDataset, estimateLeg, type MeasuredFile } from './traffic/hierarchy';
import { ROADS } from '../data/network';

const date = new Date(2026, 8, 8, 12);

describe('reported planning failures', () => {
  it.each(['FASTEST', 'SHORTEST'] as const)('honors %s through final ranking', async preference => {
    const plan = await planJourney({ origin: 'uttara', destination: preference === 'FASTEST' ? 'shyamoli' : 'tejgaon', date, departAt: 1020, preference });
    const metric = (o: typeof plan.recommended) => preference === 'FASTEST' ? o.travelMinutes : o.km;
    for (const alternative of plan.alternatives) expect(metric(plan.recommended)).toBeLessThanOrEqual(metric(alternative));
  });

  it.each([false, true])('deadline covers the actual arrival range, stop=%s', async stop => {
    const request = { origin: 'gulshan', destination: 'mirpur10', date, arriveBy: 1200,
      ...(stop ? { stop: { kinds: ['restaurant' as const], position: 0.5, dwellMinutes: 45 } } : {}) };
    const plan = await planJourney(request);
    expect(plan.recommended.arrival.latest + 10).toBeLessThanOrEqual(1200);
    expect(plan.departure!.arrival).toEqual(plan.recommended.arrival);
    if (stop) expect(plan.recommended.stop).not.toBeNull();
    const { arriveBy: _deadline, ...fixed } = request;
    const latest = await planJourney({ ...fixed, departAt: plan.departure!.latestSafe });
    expect(latest.recommended.arrival.latest + 10).toBeLessThanOrEqual(1200);
  });

  it('does not leave earlier than the requested lower bound', async () => {
    await expect(planJourney({ origin: 'gulshan', destination: 'mirpur10', date, departAt: 1020, arriveBy: 1080 }))
      .rejects.toMatchObject({ code: 'DEADLINE_UNREACHABLE' });
  });

  it('cannot satisfy a requested stop by silently dropping it', async () => {
    await expect(planJourney({ origin: 'gulshan', destination: 'mirpur10', date, departAt: 1000, arriveBy: 1200,
      stop: { kinds: ['restaurant'], position: 0.5, dwellMinutes: 45, cuisine: 'nonexistent-cuisine' } }))
      .rejects.toMatchObject({ code: 'DEADLINE_UNREACHABLE' });
  });
});

describe('sentence, form and API parity', () => {
  it('preserves every constraint and resets stale preference', () => {
    form.preference = 'SHORTEST';
    const parsed = parseJourneyText('Gulshan to Mirpur at 6 PM tomorrow eat Chinese for 30 minutes', date);
    expect(parsed.ok).toBe(true);
    applyIntent(parsed.request!);
    const api = toJourneyRequest({ text: 'Gulshan to Mirpur at 6 PM tomorrow eat Chinese for 30 minutes' }, date);
    expect('request' in api).toBe(true);
    if ('request' in api) expect(requestFromState()).toEqual({ ...api.request, preference: 'BALANCED' });
    expect(form.stopCuisine).toBe('chinese');
    expect(form.stopDwell).toBe(30);
    expect(form.departMinutes).toBe(1080);
    const next = parseJourneyText('Gulshan to Mirpur at 5 PM by 9 PM', date);
    applyIntent(next.request!);
    expect(requestFromState()).toMatchObject({ departAt: 1020, arriveBy: 1260 });
    expect(requestFromState().stop).toBeUndefined();
  });

  it('keeps colon-form morning times and reads the day after tomorrow', () => {
    const parsed = parseJourneyText('Gulshan to Mirpur at 05:30 day after tomorrow', date);
    expect(parsed.request).toMatchObject({ departAt: 330, date: '2026-09-10' });
  });

  it.each(['without a restaurant stop', 'no coffee', 'skip lunch', "don't eat"] )('respects stop negation: %s', words => {
    expect(parseJourneyText('Gulshan to Mirpur at 5 PM ' + words, date).request?.stop).toBeUndefined();
  });

  it.each(['2026-02-31', '2026-02-29', '2026-04-31'])('rejects impossible date %s', value => {
    expect(validateIntent({ origin: 'gulshan', destination: 'mirpur10', date: value }).ok).toBe(false);
  });

  it('rejects a time that rounds outside the requested day', () => {
    expect(validateIntent({ origin: 'gulshan', destination: 'mirpur10', date: '2026-09-08', departAt: 1439.9 }).ok).toBe(false);
  });
});

describe('evidence and opening hours', () => {
  it('later closure and replacement hours override earlier rules', () => {
    expect(isOpenAt('24/7; Tu off', date)).toBe('closed');
    expect(isOpenAt('Mo-Su 09:00-23:00; Tu 17:00-20:00', date)).toBe('closed');
    expect(isOpenAt('Mo-Su 18:00-02:00; Tu off', new Date(2026, 8, 8, 1))).toBe('closed');
  });

  it('never promotes a provider forecast to a measurement', () => {
    const road = ROADS[0]!;
    const data: MeasuredFile = { evidence: 'provider-estimate', roads: { [road.a + '|' + road.b]: {
      km: road.km, freeMinutes: 2, working: Array(24).fill(10), weekend: Array(24).fill(8),
      stats: { working: Array(24).fill({ n: 100, p10: 8, p50: 10, p90: 12 }), weekend: [] },
    } } };
    expect(estimateFromDataset(road, 17, 'working', data)).toMatchObject({ tier: 'provider', samples: 0, p10Minutes: null, p90Minutes: null, ageHours: null });
    delete data.evidence;
    expect(estimateFromDataset(road, 17, 'working', data)).toBeNull();
    data.source = 'Google Routes API, predictive departureTime';
    expect(estimateFromDataset(road, 17, 'working', data)?.tier).toBe('provider');
  });

  it('hour changes cannot make a later baseline departure arrive earlier', () => {
    for (const road of ROADS) for (const day of ['working', 'weekend'] as const) {
      for (let h = 1; h < 24; h++) {
        const before = h - 1 / 3600;
        expect(before * 60 + estimateLeg(road, before, day).minutes)
          .toBeLessThanOrEqual(h * 60 + estimateLeg(road, h, day).minutes + 1e-8);
      }
    }
  });
});
