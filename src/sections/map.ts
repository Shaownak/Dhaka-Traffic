/* =====================================================================
   4. CORRIDOR MAP — Dhaka Main Road Network & Elevated MRT Line 6
   High-contrast topological transit map with junction hotspots & interactive inspection
   ===================================================================== */
import { select } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { extent } from 'd3-array';
import { easeCubicOut } from 'd3-ease';
import 'd3-transition';
import {
  LABEL_RIGHT,
  LINKS,
  MAP_KEY,
  METRO_LINE_6,
  NODES,
  type MapLink,
  type MapNode,
} from '../data/traffic';
import { CREAM, INK, METRO, REDUCED, speedColor } from '../util';

let showMetro = true;
let onCorridorSelectCallback: ((corridorName: string) => void) | null = null;

export function onCorridorSelect(cb: (corridorName: string) => void): void {
  onCorridorSelectCallback = cb;
}

export function drawMap(): void {
  const svg = select<SVGSVGElement, unknown>('#map');
  if (svg.empty()) return;
  svg.selectAll('*').remove();

  const W = 900;
  const H = 640;
  const padX = 132;
  const padY = 46;
  const ex = extent(NODES, (n) => n.x) as [number, number];
  const ey = extent(NODES, (n) => n.y) as [number, number];
  const X = scaleLinear().domain(ex).range([padX, W - padX]);
  const Y = scaleLinear().domain(ey).range([padY, H - padY - 50]);
  const byId = new Map(NODES.map((n) => [n.id, n]));
  const width = scaleLinear().domain([0.4, 1]).range([10, 24]);

  const sx = (d: MapLink): number => X(byId.get(d.s)!.x);
  const sy = (d: MapLink): number => Y(byId.get(d.s)!.y);
  const tx = (d: MapLink): number => X(byId.get(d.t)!.x);
  const ty = (d: MapLink): number => Y(byId.get(d.t)!.y);

  const g = svg.append('g');

  // Road casing underlayer
  g.selectAll<SVGLineElement, MapLink>('line.shadow').data(LINKS).join('line')
    .attr('x1', sx).attr('y1', sy).attr('x2', tx).attr('y2', ty)
    .attr('stroke', '#E2D3BE').attr('stroke-width', (d) => width(d.w) + 8).attr('stroke-linecap', 'round');

  // Tooltip
  const tip = svg.append('g').attr('opacity', 0).style('pointer-events', 'none');
  const tipBg = tip.append('rect').attr('rx', 8).attr('fill', INK).attr('stroke', 'rgba(242, 163, 16, 0.4)').attr('stroke-width', 1.5);
  const tipTx = tip.append('text').attr('fill', CREAM).attr('class', 't-lab').attr('y', 21).attr('x', 14);

  const enter = (_e: Event, d: MapLink): void => {
    svg.classed('hot', true);
    links.classed('on', (l) => l === d);
    const mx = (sx(d) + tx(d)) / 2;
    const my = (sy(d) + ty(d)) / 2;
    tipTx.text(`${d.s} to ${d.t} · ${d.v} km/h at peak · click to inspect`);
    const w = (tipTx.node()?.getComputedTextLength() ?? 0) + 28;
    tipBg.attr('width', w).attr('height', 36);
    tip.attr('transform', `translate(${Math.max(8, Math.min(W - w - 8, mx - w / 2))},${my - 50})`)
      .transition().duration(120).attr('opacity', 1);
  };

  const leave = (): void => {
    svg.classed('hot', false);
    links.classed('on', false);
    tip.transition().duration(120).attr('opacity', 0);
  };

  const clickLink = (_e: Event, d: MapLink): void => {
    const routeName = `${d.s} to ${d.t}`;
    onCorridorSelectCallback?.(routeName);
  };

  const links = g.selectAll<SVGLineElement, MapLink>('line.road').data(LINKS).join('line')
    .attr('class', 'road')
    .attr('x1', sx).attr('y1', sy).attr('x2', sx).attr('y2', sy)
    .attr('stroke', (d) => speedColor(d.v))
    .attr('stroke-width', (d) => width(d.w))
    .attr('stroke-linecap', 'round')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (d) => `${d.s} to ${d.t}, ${d.v} kilometers per hour at peak`)
    .on('pointerenter', enter)
    .on('pointerleave', leave)
    .on('focus', enter)
    .on('blur', leave)
    .on('click', clickLink)
    .on('keydown', (e: KeyboardEvent, d: MapLink) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        clickLink(e, d);
      }
    });

  // Redundant encoding. The color ramp survives a color-blindness audit, but it
  // should never be the only channel: the slowest corridors are also hatched,
  // and every corridor prints its own number beside it.
  g.selectAll<SVGLineElement, MapLink>('line.hatch').data(LINKS.filter((d) => d.v < 6)).join('line')
    .attr('class', 'hatch')
    .attr('x1', sx).attr('y1', sy).attr('x2', tx).attr('y2', ty)
    .attr('stroke', 'rgba(32,19,14,.55)')
    .attr('stroke-width', (d) => width(d.w) * 0.5)
    .attr('stroke-dasharray', '2 7')
    .attr('stroke-linecap', 'round')
    .style('pointer-events', 'none');

  g.selectAll<SVGTextElement, MapLink>('text.roadval').data(LINKS).join('text')
    .attr('class', 'roadval')
    .attr('x', (d) => (sx(d) + tx(d)) / 2)
    .attr('y', (d) => (sy(d) + ty(d)) / 2 + 4)
    .attr('text-anchor', 'middle')
    .attr('fill', INK)
    .attr('font-size', 11)
    .attr('font-weight', 700)
    .attr('paint-order', 'stroke')
    .attr('stroke', CREAM)
    .attr('stroke-width', 3.5)
    .attr('stroke-linejoin', 'round')
    .style('pointer-events', 'none')
    .text((d) => d.v);

  links.transition().duration(REDUCED ? 0 : 700).delay((_d, i) => (REDUCED ? 0 : i * 70)).ease(easeCubicOut)
    .attr('x2', tx).attr('y2', ty);

  // ---------- Elevated MRT Line 6 Layer ----------
  const metroG = g.append('g').attr('class', 'metro-layer')
    .attr('opacity', showMetro ? 1 : 0)
    .style('transition', 'opacity 0.3s ease');

  const metroNodes = METRO_LINE_6.map((id) => byId.get(id)!).filter(Boolean);
  for (let i = 0; i < metroNodes.length - 1; i++) {
    const p1 = metroNodes[i]!;
    const p2 = metroNodes[i + 1]!;
    // Elevated concrete beam underlayer
    metroG.append('line')
      .attr('x1', X(p1.x)).attr('y1', Y(p1.y))
      .attr('x2', X(p2.x)).attr('y2', Y(p2.y))
      .attr('stroke', 'rgba(32,19,14,.18)').attr('stroke-width', 9).attr('stroke-linecap', 'round');
    // Glowing cyan electric rail
    metroG.append('line')
      .attr('x1', X(p1.x)).attr('y1', Y(p1.y))
      .attr('x2', X(p2.x)).attr('y2', Y(p2.y))
      .attr('stroke', METRO).attr('stroke-width', 4.5).attr('stroke-dasharray', '6 4')
      .attr('stroke-linecap', 'round');
  }

  // Stations
  metroNodes.forEach((n) => {
    const sG = metroG.append('g').attr('transform', `translate(${X(n.x)},${Y(n.y)})`);
    sG.append('circle').attr('r', 11).attr('fill', CREAM).attr('stroke', METRO).attr('stroke-width', 2.5);
    sG.append('circle').attr('r', 4.5).attr('fill', METRO);
  });

  // Regular street nodes with junction hotspots
  const n = g.selectAll<SVGGElement, MapNode>('g.n').data(NODES).join('g')
    .attr('transform', (d) => `translate(${X(d.x)},${Y(d.y)})`);

  // Hotspot halo for known worst bottlenecks
  n.filter((d) => d.id === 'Mohakhali' || d.id === 'Farmgate' || d.id === 'Shahbagh')
    .append('circle')
    .attr('r', 15)
    .attr('fill', 'rgba(196, 35, 72, 0.22)')
    .attr('stroke', '#C42348')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '3 3');

  n.append('circle').attr('r', 7.5).attr('fill', CREAM).attr('stroke', INK).attr('stroke-width', 2.8);
  n.append('text')
    .attr('x', (d) => (LABEL_RIGHT.has(d.id) ? 18 : -18))
    .attr('text-anchor', (d) => (LABEL_RIGHT.has(d.id) ? 'start' : 'end'))
    .attr('y', 5).attr('class', 't-lab').attr('fill', INK).attr('font-weight', 700).text((d) => d.id);

  // Map Key & MRT Legend
  const key = svg.append('g').attr('transform', `translate(${padX - 40},${H - 12})`);
  MAP_KEY.forEach((k, i) => {
    const dx = i * 155;
    key.append('rect').attr('x', dx).attr('y', -11).attr('width', 24).attr('height', 8).attr('rx', 4)
      .attr('fill', k.color);
    key.append('text').attr('x', dx + 30).attr('y', -4).attr('class', 't-sm').attr('fill', '#7A5C53').attr('font-weight', 600)
      .text(k.label);
  });

  // MRT Legend Pill
  const metroKey = key.append('g').attr('transform', `translate(${MAP_KEY.length * 155 + 10}, 0)`);
  metroKey.append('line').attr('x1', 0).attr('x2', 26).attr('y1', -7).attr('y2', -7)
    .attr('stroke', METRO).attr('stroke-width', 4).attr('stroke-dasharray', '4 3');
  metroKey.append('text').attr('x', 34).attr('y', -4).attr('class', 't-sm').attr('fill', '#0D6A6C').attr('font-weight', 700)
    .text('MRT Line 6 (Elevated)');

  // Wire MRT toggle button
  const toggleBtn = document.getElementById('mapMetroToggle') as HTMLButtonElement | null;
  if (toggleBtn && toggleBtn.dataset['wired'] !== '1') {
    toggleBtn.dataset['wired'] = '1';
    toggleBtn.addEventListener('click', () => {
      showMetro = !showMetro;
      toggleBtn.setAttribute('aria-pressed', String(showMetro));
      toggleBtn.textContent = showMetro ? 'Hide Metro Rail (MRT-6)' : 'Show Metro Rail (MRT-6)';
      metroG.attr('opacity', showMetro ? 1 : 0);
    });
  }
}
