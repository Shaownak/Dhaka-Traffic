import { describe, expect, it } from 'vitest';
import { isOpenAt } from './opening-hours';

/** 2026-09-08 is a Tuesday. */
const tuesday = (h: number, m = 0): Date => new Date(2026, 8, 8, h, m);
/** 2026-09-13 is a Sunday. */
const sunday = (h: number, m = 0): Date => new Date(2026, 8, 13, h, m);

describe('reading what OSM stated', () => {
  it('handles a plain daily range', () => {
    expect(isOpenAt('Mo-Su 11:00-23:00', tuesday(19))).toBe('open');
    expect(isOpenAt('Mo-Su 11:00-23:00', tuesday(9))).toBe('closed');
    expect(isOpenAt('Mo-Su 11:00-23:00', tuesday(23, 30))).toBe('closed');
  });

  it('handles round the clock', () => {
    expect(isOpenAt('24/7', tuesday(3))).toBe('open');
    expect(isOpenAt('24/7', sunday(3))).toBe('open');
  });

  it('respects the days a rule names', () => {
    expect(isOpenAt('Mo-Fr 09:00-18:00', tuesday(10))).toBe('open');
    expect(isOpenAt('Mo-Fr 09:00-18:00', sunday(10))).toBe('closed');
  });

  it('handles several rules', () => {
    const spec = 'Mo-Fr 09:00-18:00; Sa 10:00-14:00';
    expect(isOpenAt(spec, tuesday(10))).toBe('open');
    expect(isOpenAt(spec, sunday(11))).toBe('closed');
  });

  it('handles an explicit closure', () => {
    const spec = 'Mo-Sa 09:00-18:00; Su off';
    expect(isOpenAt(spec, tuesday(10))).toBe('open');
    expect(isOpenAt(spec, sunday(10))).toBe('closed');
  });

  it('handles a range that runs past midnight', () => {
    // open Tuesday evening through Wednesday small hours
    expect(isOpenAt('Mo-Su 18:00-02:00', tuesday(23))).toBe('open');
    expect(isOpenAt('Mo-Su 18:00-02:00', tuesday(1))).toBe('open');
    expect(isOpenAt('Mo-Su 18:00-02:00', tuesday(15))).toBe('closed');
  });

  it('handles a split day', () => {
    const spec = 'Mo-Su 11:00-15:00,18:00-23:00';
    expect(isOpenAt(spec, tuesday(12))).toBe('open');
    expect(isOpenAt(spec, tuesday(16))).toBe('closed');
    expect(isOpenAt(spec, tuesday(20))).toBe('open');
  });

  it('handles a wrapping day range', () => {
    expect(isOpenAt('Sa-Mo 10:00-20:00', sunday(12))).toBe('open');
    expect(isOpenAt('Sa-Mo 10:00-20:00', tuesday(12))).toBe('closed');
  });
});

describe('refusing to guess', () => {
  it('is unknown when nothing was stated', () => {
    expect(isOpenAt(undefined, tuesday(12))).toBe('unknown');
    expect(isOpenAt('', tuesday(12))).toBe('unknown');
    expect(isOpenAt('   ', tuesday(12))).toBe('unknown');
  });

  it('is unknown rather than wrong for syntax it cannot read', () => {
    // all real opening_hours syntax, all beyond this parser
    for (const spec of [
      'sunrise-sunset',
      'Mo-Fr 09:00-18:00; PH off',
      'Apr-Sep: Mo-Su 10:00-22:00',
      'week 1-20 Mo-Fr 08:00-16:00',
      'Mo[1] 10:00-12:00',
      'nonsense',
    ]) {
      expect(isOpenAt(spec, tuesday(12)), spec).toBe('unknown');
    }
  });

  it('never reports open on unreadable input', () => {
    // the asymmetry that matters: a bad parse must not send somebody to a
    // restaurant that is shut
    for (const spec of ['sunrise-sunset', 'Apr-Sep 10:00-22:00', '???']) {
      expect(isOpenAt(spec, tuesday(12))).not.toBe('open');
    }
  });
});
