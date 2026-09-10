import { describe, expect, it } from 'vitest';
import { CONGESTION_SHARE, EQUIVALENTS, ROUTES, WORK_YEAR } from '../data/traffic';

describe('cost calculations & opportunity equivalents', () => {
  it('calculates commuting days accurately', () => {
    const standardDays = 5 * WORK_YEAR.weeksPerYear;
    expect(standardDays).toBe(260);

    const sixDayCommute = 6 * WORK_YEAR.weeksPerYear;
    expect(sixDayCommute).toBe(312);
  });

  it('computes annual lost commute hours correctly from one-way time', () => {
    const oneWayMinutes = 60;
    const daysPerWeek = 5;
    const annualCommuteHours = (oneWayMinutes * 2 * daysPerWeek * WORK_YEAR.weeksPerYear) / 60;
    expect(annualCommuteHours).toBe(520);

    const lostHours = Math.round(annualCommuteHours * CONGESTION_SHARE);
    expect(lostHours).toBe(Math.round(520 * 0.55));
    expect(lostHours).toBe(286);
  });

  it('translates lost hours to working days using 8-hour benchmark', () => {
    const hours = 412; // Mohakhali to Farmgate
    const lostDays = Math.max(1, Math.round(hours / WORK_YEAR.workingDayHours));
    expect(lostDays).toBe(52);
  });

  it('calculates books and films equivalents properly', () => {
    const hours = 412;
    const books = Math.floor(hours / EQUIVALENTS.bookHours);
    const movies = Math.floor(hours / EQUIVALENTS.filmHours);
    expect(books).toBe(Math.floor(412 / 7));
    expect(movies).toBe(Math.floor(412 / 2.2));
    expect(books).toBeGreaterThan(0);
    expect(movies).toBeGreaterThan(0);
  });

  it('calculates lost monetary value based on monthly wage', () => {
    const salary = 45000;
    const daysPerWeek = 5;
    const workingDaysYear = daysPerWeek * WORK_YEAR.weeksPerYear;
    const monthlyHours = (workingDaysYear * WORK_YEAR.workingDayHours) / 12;
    const hourlyWage = salary / monthlyHours;

    const lostHours = 412;
    const moneyLostBdt = Math.round(lostHours * hourlyWage);
    expect(moneyLostBdt).toBeGreaterThan(0);
    expect(moneyLostBdt).toBeCloseTo((412 * 45000) / (260 * 8 / 12), -2);
  });

  it('verifies ROUTES preset data integrity', () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(5);
    for (const r of ROUTES) {
      expect(r.name).toBeTruthy();
      expect(r.hours).toBeGreaterThan(0);
      expect(r.hours).toBeLessThan(1000);
    }
  });
});
