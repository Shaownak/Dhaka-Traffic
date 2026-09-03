/* =====================================================================
   8. THE QUIET RING — the hours the roads carry what they were built for
   ===================================================================== */
import { select } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { arc } from 'd3-shape';
import 'd3-transition';
import { NIGHT } from '../data/traffic';
import { CREAM, REDUCED } from '../util';

export function drawNight(): void {
  const svg = select<SVGSVGElement, unknown>('#night');
  if (svg.empty()) return;
  svg.selectAll('*').remove();

  const g = svg.append('g').attr('transform', 'translate(200,200)');
  const a = scaleLinear().domain([0, 24]).range([0, 2 * Math.PI]);
  const ring = arc().innerRadius(126).outerRadius(150).cornerRadius(12);
  const pad = 0.014;
  const hours = Array.from({ length: 24 }, (_, h) => h);

  g.selectAll<SVGPathElement, number>('path').data(hours).join('path')
    .attr('fill', (h) => (h < NIGHT.untilHour ? '#3FA88A' : 'rgba(246,238,224,.10)'))
    .attr('d', (h) => ring({ innerRadius: 126, outerRadius: 150, startAngle: a(h) + pad, endAngle: a(h + 1) - pad }))
    .attr('opacity', (h) => (h < NIGHT.untilHour ? 0 : 1))
    .transition().duration(REDUCED ? 0 : 700).delay((h) => (REDUCED ? 0 : h * 130))
    .attr('opacity', 1);

  g.append('text').attr('text-anchor', 'middle').attr('y', -4)
    .attr('font-family', 'var(--display)').attr('font-weight', 900).attr('font-size', 58)
    .attr('fill', CREAM).text(NIGHT.kmh);
  g.append('text').attr('text-anchor', 'middle').attr('y', 24)
    .attr('class', 't-sm').attr('fill', '#8FB6B6')
    .text('km/h, midnight to 5:00 AM');
}
