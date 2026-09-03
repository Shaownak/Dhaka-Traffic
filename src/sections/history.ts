/* =====================================================================
   3. THE RECORD — Historical Speed Measurements in Dhaka
   High-precision area chart with glowing trajectory, halo nodes & tooltips
   ===================================================================== */
import { select } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { area, line } from 'd3-shape';
import { easeCubicOut } from 'd3-ease';
import 'd3-transition';
import { SOURCES, SPEED_HISTORY, SUPPLY_DEMAND, type SpeedPoint } from '../data/traffic';
import { CREAM, REDUCED, TEAL, speedColor } from '../util';

const W = 1000;
const H = 450;
const PAD = { top: 48, right: 48, bottom: 84, left: 68 };

function yearLabel(d: SpeedPoint): string {
  return d.yearLabel ?? String(d.year);
}

function sentence(d: SpeedPoint): string {
  const src = SOURCES[d.source];
  const metric = d.metric === 'projection' ? 'projected average speed' : `${d.metric} speed`;
  return `${yearLabel(d)}: ${d.kmh} km/h — ${metric}, published by ${src?.publisher ?? 'Research study'} (${src?.year ?? d.year}).`;
}

export function drawHistory(): void {
  const svg = select<SVGSVGElement, unknown>('#history');
  if (svg.empty()) return;
  svg.selectAll('*').remove();
  svg.attr('viewBox', `0 0 ${W} ${H}`);

  const defs = svg.append('defs');

  // Gradient area fill under history line
  const areaGrad = defs.append('linearGradient').attr('id', 'historyAreaGrad')
    .attr('x1', '0%').attr('y1', '0%').attr('x2', '0%').attr('y2', '100%');
  areaGrad.append('stop').attr('offset', '0%').attr('stop-color', '#F2A310').attr('stop-opacity', 0.28);
  areaGrad.append('stop').attr('offset', '65%').attr('stop-color', '#C42348').attr('stop-opacity', 0.12);
  areaGrad.append('stop').attr('offset', '100%').attr('stop-color', '#0D6A6C').attr('stop-opacity', 0.0);

  const x = scaleLinear().domain([2005, 2037]).range([PAD.left, W - PAD.right]);
  const y = scaleLinear().domain([0, 24]).range([H - PAD.bottom, PAD.top]);

  const measured = SPEED_HISTORY.filter((d) => d.metric !== 'projection');
  const projected = SPEED_HISTORY.filter((d) => d.metric === 'projection');
  const last = measured[measured.length - 1];

  const readout = document.getElementById('historyReadout');
  const show = (text: string): void => {
    if (readout) readout.textContent = text;
  };
  const resting = last ? sentence(last) : '';
  show(resting);

  /* ---------- grid & axes ---------- */
  const grid = svg.append('g');
  for (const v of [5, 10, 15, 20]) {
    grid.append('line')
      .attr('x1', PAD.left).attr('x2', W - PAD.right).attr('y1', y(v)).attr('y2', y(v))
      .attr('stroke', 'rgba(246, 238, 224, 0.14)').attr('stroke-width', 1);
    grid.append('text')
      .attr('x', PAD.left - 14).attr('y', y(v) + 4).attr('text-anchor', 'end')
      .attr('class', 't-sm').attr('fill', '#A6D8D5').text(`${v}`);
  }
  grid.append('text')
    .attr('x', PAD.left - 14).attr('y', PAD.top - 18).attr('text-anchor', 'end')
    .attr('class', 't-sm').attr('fill', '#A6D8D5').attr('font-weight', 700).text('Speed (km/h)');

  // Comfortable walking pace baseline (5 km/h)
  const walk = 5;
  grid.append('rect')
    .attr('x', PAD.left).attr('y', y(walk) - 12)
    .attr('width', W - PAD.left - PAD.right).attr('height', 24)
    .attr('fill', 'rgba(242, 163, 16, 0.06)');

  grid.append('line')
    .attr('x1', PAD.left).attr('x2', W - PAD.right).attr('y1', y(walk)).attr('y2', y(walk))
    .attr('stroke', '#F2A310').attr('stroke-width', 1.8).attr('stroke-dasharray', '6 6');

  grid.append('text')
    .attr('x', W - PAD.right).attr('y', y(walk) - 14).attr('text-anchor', 'end')
    .attr('class', 't-sm').attr('fill', '#F2A310').attr('font-weight', 700)
    .text('Normal walking speed, about 5 km/h');

  /* ---------- area fill & curves ---------- */
  const areaGen = area<SpeedPoint>()
    .x((d) => x(d.year))
    .y0(y(0))
    .y1((d) => y(d.kmh));

  const path = line<SpeedPoint>().x((d) => x(d.year)).y((d) => y(d.kmh));

  // Area under measured curve
  svg.append('path')
    .attr('d', areaGen(measured))
    .attr('fill', 'url(#historyAreaGrad)');

  // Measured curve
  const measuredPath = svg.append('path')
    .attr('d', path(measured))
    .attr('fill', 'none').attr('stroke', CREAM).attr('stroke-width', 3.5)
    .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');

  // Projected trajectory to 2035
  if (last && projected[0]) {
    svg.append('path')
      .attr('d', path([last, projected[0]]))
      .attr('fill', 'none').attr('stroke', 'rgba(246, 238, 224, 0.55)').attr('stroke-width', 2.5)
      .attr('stroke-dasharray', '4 8').attr('stroke-linecap', 'round');
  }

  if (!REDUCED) {
    const len = measuredPath.node()?.getTotalLength() ?? 0;
    measuredPath
      .attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
      .transition().duration(1200).ease(easeCubicOut).attr('stroke-dashoffset', 0);
  }

  /* ---------- data nodes ---------- */
  const points = svg.selectAll<SVGGElement, SpeedPoint>('g.pt').data(SPEED_HISTORY).join('g')
    .attr('class', 'pt')
    .attr('transform', (d) => `translate(${x(d.year)},${y(d.kmh)})`)
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', sentence);

  // Halo for latest observed point (2022)
  points.filter((d) => d.year === 2022)
    .append('circle')
    .attr('r', 20)
    .attr('fill', 'none')
    .attr('stroke', '#E0662A')
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 0.5)
    .attr('stroke-dasharray', '3 3');

  points.append('circle')
    .attr('r', 12)
    .attr('fill', (d) => (d.metric === 'projection' ? TEAL : speedColor(d.kmh)))
    .attr('stroke', (d) => (d.metric === 'projection' ? 'rgba(246, 238, 224, 0.8)' : CREAM))
    .attr('stroke-width', 3)
    .attr('stroke-dasharray', (d) => (d.metric === 'projection' ? '3 4' : null));

  // Numerical value above the dot
  points.append('text')
    .attr('y', -24).attr('text-anchor', 'middle')
    .attr('font-family', 'var(--display)').attr('font-weight', 900).attr('font-size', 32)
    .attr('fill', CREAM).text((d) => d.kmh);

  // Year below dot
  points.append('text')
    .attr('y', 34).attr('text-anchor', 'middle')
    .attr('class', 't-sm').attr('fill', '#C2EAE6').attr('font-weight', 700)
    .text(yearLabel);

  // Metric type tag
  points.append('text')
    .attr('y', 52).attr('text-anchor', 'middle')
    .attr('class', 't-sm').attr('fill', 'rgba(194, 234, 230, 0.85)')
    .text((d) => (d.metric === 'projection' ? 'projection' : d.metric));

  const enter = (_e: Event, d: SpeedPoint): void => {
    svg.classed('hot', true);
    points.classed('on', (p) => p === d);
    show(sentence(d));
  };
  const leave = (): void => {
    svg.classed('hot', false);
    points.classed('on', false);
    show(resting);
  };
  points.on('pointerenter', enter).on('pointerleave', leave).on('focus', enter).on('blur', leave);
}

/* =====================================================================
   WHY IT SLOWED — the one comparison that explains the rest

   The page documents the symptom in five different ways. This is the cause:
   over the decade to 2005, demand on Dhaka's roads grew many times faster
   than the roads did. Drawn as three bars on one axis so the divergence is
   the shape you see, not a number you have to hold in your head.
   ===================================================================== */
export function drawSupplyDemand(): void {
  const svg = select<SVGSVGElement, unknown>('#supplyDemand');
  if (svg.empty()) return;
  svg.selectAll('*').remove();

  const W = 1000;
  const rowH = 82;
  const labelW = 210;
  const H = SUPPLY_DEMAND.series.length * rowH + 20;
  svg.attr('viewBox', `0 0 ${W} ${H}`).style('aspect-ratio', `${W} / ${H}`);

  const max = Math.max(...SUPPLY_DEMAND.series.map((s) => s.percent));
  const x = scaleLinear().domain([0, max]).range([labelW, W - 120]);

  SUPPLY_DEMAND.series.forEach((s, i) => {
    const y = i * rowH + 30;
    // the roads are the flat one; it carries the accent so the eye lands there
    const isRoad = i === 0;
    const g = svg.append('g');

    g.append('text')
      .attr('x', labelW - 22).attr('y', y + 22).attr('text-anchor', 'end')
      .attr('class', 't-lab').attr('fill', CREAM).attr('font-weight', 700)
      .text(s.label);

    g.append('rect')
      .attr('x', labelW).attr('y', y).attr('height', 34).attr('rx', 4)
      .attr('fill', isRoad ? 'var(--marigold)' : 'rgba(246,238,224,.32)')
      .attr('width', REDUCED ? x(s.percent) - labelW : 0)
      .transition().duration(REDUCED ? 0 : 900).delay(REDUCED ? 0 : i * 140).ease(easeCubicOut)
      .attr('width', x(s.percent) - labelW);

    g.append('text')
      .attr('x', x(s.percent) + 16).attr('y', y + 26)
      .attr('font-family', 'var(--display)').attr('font-weight', 900).attr('font-size', 28)
      .attr('fill', isRoad ? 'var(--marigold)' : CREAM)
      .text(`+${s.percent}%`);
  });
}
