/* =====================================================================
   2. THE RACE — One Kilometer: Car vs Pedestrian vs Metro Rail (MRT-6)
   Enhanced Editorial Data Visualization with Distance Milestones & Time Readouts
   ===================================================================== */
import { select, type Selection } from 'd3-selection';
import { easeLinear } from 'd3-ease';
import 'd3-transition';
import { RACE } from '../data/traffic';
import { CREAM, INK, METRO, REDUCED } from '../util';

let generation = 0;
let restartTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Set by drawRace, driven by startRace/stopRace.
 *
 * The race does not run on page load. The metro crosses the kilometre in about
 * a seventh of the time the car needs, so it spends most of a cycle parked at
 * the finish — a reader arriving mid-cycle would never see the fastest thing on
 * the page move at all. It starts when the section is actually on screen, and
 * resets when it leaves, so every reader sees it from the start line.
 */
let lane: {
  car: Selection<SVGGElement, unknown, HTMLElement, unknown>;
  ped: Selection<SVGGElement, unknown, HTMLElement, unknown>;
  metro: Selection<SVGGElement, unknown, HTMLElement, unknown>;
  xAt: (p: number) => number;
} | null = null;

function duration(kmh: number): number {
  return (RACE.msPerWalkedKm * RACE.walkKmh) / kmh;
}

export function drawRace(): void {
  const svg = select<SVGSVGElement, unknown>('#race').attr('viewBox', '0 0 1000 340');
  if (svg.empty()) return;
  svg.selectAll('*').remove();

  // generation is bumped by resetRace() at the end of this function
  const x0 = 36;
  const x1 = 920;
  const trackW = x1 - x0;

  /**
   * One coordinate system for the axis and all three markers.
   *
   * Each marker's centre at progress p sits exactly on the p milestone, so
   * comparing two markers by eye compares two real distances. The track is
   * inset by the widest marker's half-width — the same inset for everyone — so
   * nothing overhangs the ribbon at either end. Giving each marker its own
   * inset, as this did before, silently gave them different track lengths and
   * put the car ahead of the walker it is supposed to lose to.
   */
  const inset = 46;
  const s0 = x0 + inset;
  const s1 = x1 - inset;
  const xAt = (p: number): number => s0 + p * (s1 - s0);

  /** Minutes to cover one kilometre at this speed. */
  const minPerKm = (kmh: number): number => 60 / kmh;

  // Defs for gradients & filters
  const defs = svg.append('defs');

  // Metro Speed Trail Gradient
  const metroGrad = defs.append('linearGradient').attr('id', 'metroTrail')
    .attr('x1', '100%').attr('y1', '0%').attr('x2', '0%').attr('y2', '0%');
  metroGrad.append('stop').attr('offset', '0%').attr('stop-color', METRO).attr('stop-opacity', 0.65);
  metroGrad.append('stop').attr('offset', '100%').attr('stop-color', METRO).attr('stop-opacity', 0);

  // Car Headlight Beam Gradient
  const lightGrad = defs.append('linearGradient').attr('id', 'headlightBeam')
    .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '0%');
  lightGrad.append('stop').attr('offset', '0%').attr('stop-color', '#FFE6A0').attr('stop-opacity', 0.55);
  lightGrad.append('stop').attr('offset', '100%').attr('stop-color', '#FFE6A0').attr('stop-opacity', 0);

  // Distance Milestone Grid (every 200 meters)
  const milestoneG = svg.append('g').attr('class', 'milestones');
  for (let m = 0; m <= 1000; m += 200) {
    const xPos = xAt(m / 1000);
    milestoneG.append('line')
      .attr('x1', xPos).attr('x2', xPos)
      .attr('y1', 46).attr('y2', 290)
      .attr('stroke', m === 1000 ? INK : 'rgba(42, 23, 18, 0.12)')
      .attr('stroke-width', m === 1000 ? 2 : 1)
      .attr('stroke-dasharray', m === 1000 ? '4 4' : '2 4');

    milestoneG.append('text')
      .attr('x', xPos).attr('y', 308)
      .attr('text-anchor', 'middle')
      .attr('class', 't-sm')
      .attr('fill', m === 1000 ? INK : '#8A6A5F')
      .attr('font-weight', m === 1000 ? 700 : 500)
      .text(m === 0 ? 'Start (0m)' : m === 1000 ? 'Finish (1,000m)' : `${m}m`);
  }

  // Lane Background Ribbons
  const laneRibbon = (y: number, h: number, bg: string, stroke: string): void => {
    svg.append('rect')
      .attr('x', x0 - 12).attr('y', y - h / 2)
      .attr('width', trackW + 24).attr('height', h)
      .attr('rx', 8)
      .attr('fill', bg)
      .attr('stroke', stroke)
      .attr('stroke-width', 1);
  };

  laneRibbon(82, 54, 'rgba(196, 35, 72, 0.05)', 'rgba(196, 35, 72, 0.18)');
  laneRibbon(162, 54, 'rgba(42, 23, 18, 0.03)', 'rgba(42, 23, 18, 0.12)');
  laneRibbon(242, 54, 'rgba(22, 20, 64, 0.05)', 'rgba(22, 20, 64, 0.22)');

  // Lane Labels with Expected Time Badges
  const laneHeader = (y: number, label: string, timeText: string, tagColor: string): void => {
    svg.append('text').attr('x', x0).attr('y', y - 14).attr('class', 't-lab')
      .attr('fill', tagColor).attr('font-weight', 700).text(label);

    svg.append('text').attr('x', s1 - 8).attr('y', y - 14).attr('text-anchor', 'end')
      .attr('class', 't-sm').attr('fill', tagColor).attr('font-weight', 700).text(timeText);
  };

  // Times are computed, never typed. A hardcoded "12.5 min" would keep saying
  // so after someone changed the speed it was derived from.
  const faster = (RACE.metroKmh / RACE.carKmh).toFixed(1);
  laneHeader(74, `Car at peak hour (${RACE.carKmh} km/h)`,
    `${minPerKm(RACE.carKmh).toFixed(1)} min per km`, '#C42348');
  laneHeader(154, `Comfortable walking pace (${RACE.walkKmh} km/h)`,
    `${minPerKm(RACE.walkKmh).toFixed(1)} min per km`, '#4A3A34');
  laneHeader(234, `Elevated Metro Rail, MRT Line 6 (${RACE.metroKmh} km/h)`,
    `${minPerKm(RACE.metroKmh).toFixed(1)} min per km — ${faster}x the car`, '#161440');

  // Track rails / guideline
  for (const ly of [84, 164, 244]) {
    svg.append('line').attr('x1', x0).attr('x2', x1).attr('y1', ly).attr('y2', ly)
      .attr('stroke', 'rgba(42, 23, 18, 0.14)').attr('stroke-width', 2).attr('stroke-linecap', 'round');
  }

  // 1. CAR
  const car = svg.append('g');
  // Headlight beam
  car.append('polygon').attr('points', '28,-6 90,-22 90,22 28,6').attr('fill', 'url(#headlightBeam)');
  // Chassis
  car.append('rect').attr('x', -28).attr('y', -12).attr('width', 56).attr('height', 24).attr('rx', 6).attr('fill', '#C42348');
  car.append('rect').attr('x', -14).attr('y', -8.5).attr('width', 24).attr('height', 9).attr('rx', 2.5).attr('fill', CREAM);
  car.append('circle').attr('cx', -15).attr('cy', 12).attr('r', 4.5).attr('fill', INK);
  car.append('circle').attr('cx', 15).attr('cy', 12).attr('r', 4.5).attr('fill', INK);
  car.append('rect').attr('x', 24).attr('y', -5).attr('width', 4).attr('height', 10).attr('rx', 1.5).attr('fill', '#FFE6A0');

  // 2. WALKER
  const ped = svg.append('g');
  ped.append('circle').attr('cy', -16).attr('r', 6.5).attr('fill', INK);
  ped.append('rect').attr('x', -3.5).attr('y', -8).attr('width', 7).attr('height', 17).attr('rx', 3.5).attr('fill', INK);
  ped.append('path').attr('d', 'M-1 9 L-7 23 M1 9 L7 23').attr('stroke', INK)
    .attr('stroke-width', 4).attr('stroke-linecap', 'round');

  // 3. METRO RAIL
  const metro = svg.append('g');
  // Motion speed trail
  metro.append('rect').attr('x', -120).attr('y', -7).attr('width', 80).attr('height', 14).attr('rx', 4).attr('fill', 'url(#metroTrail)');
  // Train Body (Dual car aerodynamic look)
  metro.append('rect').attr('x', -44).attr('y', -14).attr('width', 88).attr('height', 28).attr('rx', 6).attr('fill', METRO);
  // Silver aerodynamic nose
  metro.append('path').attr('d', 'M32 -14 L44 -5 L44 5 L32 14 Z').attr('fill', '#0D6A6C');
  // Passenger Windows
  for (const wx of [-34, -14, 6]) {
    metro.append('rect').attr('x', wx).attr('y', -9).attr('width', 14).attr('height', 10).attr('rx', 2.5).attr('fill', '#A8EBF2');
  }
  // Driver windscreen
  metro.append('rect').attr('x', 26).attr('y', -9).attr('width', 12).attr('height', 10).attr('rx', 2.5).attr('fill', METRO);
  // Red & Green Stripe
  metro.append('line').attr('x1', -44).attr('x2', 42).attr('y1', 4).attr('y2', 4).attr('stroke', '#3FA88A').attr('stroke-width', 3);
  metro.append('line').attr('x1', -44).attr('x2', 42).attr('y1', 7).attr('y2', 7).attr('stroke', '#C42348').attr('stroke-width', 1.5);
  // Wheels
  metro.append('circle').attr('cx', -28).attr('cy', 14).attr('r', 4.5).attr('fill', INK);
  metro.append('circle').attr('cx', 26).attr('cy', 14).attr('r', 4.5).attr('fill', INK);

  const walkDur = duration(RACE.walkKmh);
  const driveDur = duration(RACE.carKmh);
  const metroDur = duration(RACE.metroKmh);

  lane = { car, ped, metro, xAt };

  if (REDUCED) {
    // One honest frame instead of an animation: everyone placed where they
    // stand at the moment the metro finishes. All three at the finish line
    // would show no comparison at all, which is the entire point here.
    const t = metroDur;
    car.attr('transform', `translate(${xAt(Math.min(1, t / driveDur))},82)`);
    ped.attr('transform', `translate(${xAt(Math.min(1, t / walkDur))},162)`);
    metro.attr('transform', `translate(${xAt(1)},242)`);
    return;
  }

  resetRace();
}

/** Put everyone back on the start line and cancel any pending restart. */
export function resetRace(): void {
  generation++;
  clearTimeout(restartTimer);
  if (!lane || REDUCED) return;
  const { car, ped, metro, xAt } = lane;
  car.interrupt().attr('transform', `translate(${xAt(0)},82)`);
  ped.interrupt().attr('transform', `translate(${xAt(0)},162)`);
  metro.interrupt().attr('transform', `translate(${xAt(0)},242)`);
}

/** Called when the section scrolls into view. */
export function startRace(): void {
  if (!lane || REDUCED) return;
  resetRace();
  const run = generation;
  const { car, ped, metro, xAt } = lane;

  const walkDur = duration(RACE.walkKmh);
  const driveDur = duration(RACE.carKmh);
  const metroDur = duration(RACE.metroKmh);

  const start = (): void => {
    if (run !== generation) return;
    car.interrupt().attr('transform', `translate(${xAt(0)},82)`);
    ped.interrupt().attr('transform', `translate(${xAt(0)},162)`);
    metro.interrupt().attr('transform', `translate(${xAt(0)},242)`);

    // Same distance for all three; only the duration differs, and it differs
    // in exact proportion to the published speeds. The car is slowest, so it
    // owns the restart.
    car.transition().duration(driveDur).ease(easeLinear).attr('transform', `translate(${xAt(1)},82)`)
      .on('end', () => { restartTimer = setTimeout(start, RACE.restartDelayMs); });
    ped.transition().duration(walkDur).ease(easeLinear).attr('transform', `translate(${xAt(1)},162)`);
    metro.transition().duration(metroDur).ease(easeLinear).attr('transform', `translate(${xAt(1)},242)`);
  };

  start();
}
