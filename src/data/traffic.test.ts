import { describe, expect, it } from 'vitest';
import {
  CITY_FACTS,
  CONGESTION_RAMP,
  DATASETS,
  HEADLINE,
  HOURLY_SPEED_KMH,
  LINKS,
  METRO_LINE_6,
  NODES,
  RACE,
  SOLUTIONS,
  SOURCES,
  SPEED_HISTORY,
  SUPPLY_DEMAND,
  WORK_YEAR,
} from './traffic';

describe('traffic data integrity & sources', () => {
  it('verifies that HEADLINE source exists in SOURCES', () => {
    expect(SOURCES[HEADLINE.source]).toBeDefined();
    expect(SOURCES[HEADLINE.source]?.org).toBe('World Bank');
  });

  it('verifies that all SPEED_HISTORY entries reference valid sources', () => {
    for (const pt of SPEED_HISTORY) {
      expect(SOURCES[pt.source], `Missing source for year ${pt.year}: ${pt.source}`).toBeDefined();
      expect(pt.kmh).toBeGreaterThan(0);
    }
  });

  it('verifies that SUPPLY_DEMAND references a valid source', () => {
    expect(SOURCES[SUPPLY_DEMAND.source]).toBeDefined();
    expect(SUPPLY_DEMAND.series.length).toBeGreaterThanOrEqual(3);
  });

  it('verifies that all CITY_FACTS reference valid sources', () => {
    for (const fact of CITY_FACTS) {
      expect(SOURCES[fact.source], `Missing source for fact: ${fact.value}`).toBeDefined();
    }
  });

  it('verifies that RACE references valid benchmarks', () => {
    expect(SOURCES[RACE.carSource]).toBeDefined();
    expect(SOURCES[RACE.walkSource]).toBeDefined();
    expect(SOURCES[RACE.metroSource]).toBeDefined();
    expect(RACE.carKmh).toBeLessThan(RACE.walkKmh);
    expect(RACE.walkKmh).toBeLessThan(RACE.metroKmh);
  });

  it('verifies that all DATASETS with a source reference a valid key', () => {
    for (const ds of DATASETS) {
      if (ds.source) {
        expect(SOURCES[ds.source], `Missing dataset source: ${ds.source}`).toBeDefined();
      }
      expect(['measured', 'derived', 'modeled']).toContain(ds.provenance);
    }
  });

  it('verifies that HOURLY_SPEED_KMH has exactly 24 hourly values', () => {
    expect(HOURLY_SPEED_KMH.length).toBe(24);
    for (let h = 0; h < 24; h++) {
      const speed = HOURLY_SPEED_KMH[h]!;
      expect(speed).toBeGreaterThan(0);
      expect(speed).toBeLessThan(40);
    }
  });

  it('verifies that CONGESTION_RAMP is strictly ascending and has valid hex colors', () => {
    for (let i = 0; i < CONGESTION_RAMP.length - 1; i++) {
      expect(CONGESTION_RAMP[i]!.kmh).toBeLessThan(CONGESTION_RAMP[i + 1]!.kmh);
    }
    const hexPattern = /^#[0-9A-Fa-f]{6}$/;
    for (const stop of CONGESTION_RAMP) {
      expect(stop.color).toMatch(hexPattern);
    }
  });

  it('verifies work year constants', () => {
    expect(WORK_YEAR.workingDaysPerYear).toBe(WORK_YEAR.weeksPerYear * WORK_YEAR.daysPerWeek);
    expect(WORK_YEAR.workingDayHours).toBe(8);
  });

  it('verifies corridor map nodes and links consistency', () => {
    const nodeIds = new Set(NODES.map((n) => n.id));
    for (const node of NODES) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x).toBeLessThanOrEqual(1);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeLessThanOrEqual(1);
    }

    for (const link of LINKS) {
      expect(nodeIds.has(link.s), `Link source node not in NODES: ${link.s}`).toBe(true);
      expect(nodeIds.has(link.t), `Link target node not in NODES: ${link.t}`).toBe(true);
      expect(link.v).toBeGreaterThan(0);
    }

    for (const station of METRO_LINE_6) {
      expect(nodeIds.has(station), `Metro station not in NODES: ${station}`).toBe(true);
    }
  });

  it('verifies that all SOLUTIONS have non-empty titles and valid gains', () => {
    expect(SOLUTIONS.length).toBeGreaterThan(0);
    for (const s of SOLUTIONS) {
      expect(s.id).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(s.potentialGainKmh).toBeGreaterThan(0);
      expect(['transit', 'policy', 'urbanism']).toContain(s.category);
    }
  });
});
