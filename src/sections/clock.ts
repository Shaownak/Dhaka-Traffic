/* =====================================================================
   3. RADIAL CLOCK — 24-Hour Speed Cycle in Dhaka
   High-contrast radial visualization with interactive sync & clean data access
   ===================================================================== */
import { select } from 'd3-selection';
import { scaleLinear } from 'd3-scale';
import { arc } from 'd3-shape';
import { max } from 'd3-array';
import { interpolate } from 'd3-interpolate';
import { easeCubicOut } from 'd3-ease';
import 'd3-transition';
import { HOURLY_SPEED_KMH } from '../data/traffic';
import { CREAM, REDUCED, shortHourLabel, speedColor } from '../util';

interface Hour {
  h: number;
  v: number;
}

let onHourSelectCallback: ((hour: number) => void) | null = null;

export function onHourSelect(cb: (hour: number) => void): void {
  onHourSelectCallback = cb;
}

export function drawClock(): void {
  const svg = select<SVGSVGElement, unknown>('#clock');
  if (svg.empty()) return;
  svg.selectAll('*').remove();
  // The box is wider than it is tall because the 6 AM and 6 PM labels sit at
  // the left and right extremes and need room to run outward. Derive it from
  // the centre so the two can never disagree — a hardcoded viewBox here used
  // to override the one in the markup and clip both side labels.
  const cx = 360;
  const cy = 270;
  const r0 = 70;
  const rMax = 185;
  svg.attr('viewBox', `0 0 ${cx * 2} ${cy * 2}`);
  const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);
  const r = scaleLinear().domain([0, max(HOURLY_SPEED_KMH) ?? 0]).range([r0 + 10, rMax]);
  const a = scaleLinear().domain([0, 24]).range([0, 2 * Math.PI]);
  const pad = 0.014;

  // Background Central Hub Disc
  g.append('circle')
    .attr('r', r0)
    .attr('fill', '#100B26')
    .attr('stroke', 'rgba(246, 238, 224, 0.25)')
    .attr('stroke-width', 1.5);

  // Concentric Speed Guide Rings
  for (const v of [10, 20]) {
    g.append('circle').attr('r', r(v)).attr('fill', 'none')
      .attr('stroke', 'rgba(246, 238, 224, 0.12)').attr('stroke-width', 1).attr('stroke-dasharray', '3 4');
    g.append('text').attr('x', 6).attr('y', -r(v) + 12).attr('class', 't-sm')
      .attr('fill', 'rgba(185, 182, 222, 0.6)').attr('font-size', 10).text(`${v} km/h`);
  }

  const wedge = arc<Hour>().innerRadius(r0).cornerRadius(5)
    .startAngle((d) => a(d.h) + pad)
    .endAngle((d) => a(d.h + 1) - pad);

  const data: Hour[] = HOURLY_SPEED_KMH.map((v, h) => ({ h, v }));

  // Central Digital Speed & Hour Readout (carefully sized to never overflow r0)
  const centreVal = g.append('text')
    .attr('text-anchor', 'middle')
    .attr('y', -10)
    .attr('font-family', 'var(--display)')
    .attr('font-weight', 900)
    .attr('font-size', 36)
    .attr('fill', CREAM);

  g.append('text')
    .attr('text-anchor', 'middle')
    .attr('y', 10)
    .attr('class', 't-sm')
    .attr('font-size', 11.5)
    .attr('fill', '#A8A4E0')
    .attr('font-weight', 600)
    .text('km/h');

  const centreTime = g.append('text')
    .attr('text-anchor', 'middle')
    .attr('y', 28)
    .attr('class', 't-sm')
    .attr('font-size', 12.5)
    .attr('fill', 'var(--marigold)')
    .attr('font-weight', 700);

  const slowest = data.reduce((p, q) => (q.v < p.v ? q : p));
  const show = (d: Hour): void => {
    centreVal.text(d.v.toFixed(1));
    centreTime.text(shortHourLabel(d.h));
  };
  show(slowest);

  const enter = (_e: Event, d: Hour): void => {
    svg.classed('hot', true);
    wedges.classed('on', (w) => w.h === d.h);
    show(d);
  };
  const leave = (): void => {
    svg.classed('hot', false);
    wedges.classed('on', false);
    show(slowest);
  };

  const clickWedge = (_e: Event, d: Hour): void => {
    onHourSelectCallback?.(d.h);
  };

  const wedges = g.selectAll<SVGPathElement, Hour>('path.wedge').data(data).join('path')
    .attr('class', 'wedge')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', (d) => `${shortHourLabel(d.h)}, ${d.v.toFixed(1)} km/h. Click to sync simulation.`)
    .on('pointerenter', enter)
    .on('pointerleave', leave)
    .on('focus', enter)
    .on('blur', leave)
    .on('click', clickWedge)
    .on('keydown', (e: KeyboardEvent, d: Hour) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        clickWedge(e, d);
      }
    })
    .attr('fill', (d) => speedColor(d.v))
    .attr('d', (d) => wedge.outerRadius(REDUCED ? r(d.v) : r0 + 2)(d));

  wedges.transition().duration(REDUCED ? 0 : 900).delay((_d, i) => (REDUCED ? 0 : i * 45)).ease(easeCubicOut)
    .attrTween('d', (d) => {
      const grow = interpolate(r0 + 2, r(d.v));
      return (t: number) => wedge.outerRadius(grow(t))(d) ?? '';
    });

  // Time Markers around Clock with proper anchoring and margins
  const clockLabels = [
    { h: 0, label: '12 AM (Midnight)', anchor: 'middle', dx: 0, dy: -26 },
    { h: 6, label: '6 AM (Morning Rush)', anchor: 'start', dx: 22, dy: 5 },
    { h: 12, label: '12 PM (Midday)', anchor: 'middle', dx: 0, dy: 30 },
    { h: 18, label: '6 PM (Evening Peak)', anchor: 'end', dx: -22, dy: 5 },
  ];

  for (const item of clockLabels) {
    const ang = a(item.h + 0.5) - Math.PI / 2;
    const rr = rMax;
    const xPos = Math.cos(ang) * rr + item.dx;
    const yPos = Math.sin(ang) * rr + item.dy;

    g.append('text')
      .attr('x', xPos)
      .attr('y', yPos)
      .attr('text-anchor', item.anchor)
      .attr('class', 't-sm')
      .attr('fill', '#C2C0EB')
      .attr('font-weight', 700)
      .text(item.label);
  }

  buildTable(data);
}

function buildTable(data: readonly Hour[]): void {
  const host = document.getElementById('clockTable');
  const toggle = document.getElementById('clockTableToggle');
  if (!host || !toggle) return;

  host.textContent = '';
  const table = document.createElement('table');
  table.className = 'datatable';
  const caption = document.createElement('caption');
  caption.textContent = 'Hourly Average Speeds in Dhaka';
  table.append(caption);

  const head = document.createElement('tr');
  for (const h of ['Hour', 'Estimated Speed', 'Condition']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    head.append(th);
  }
  const thead = document.createElement('thead');
  thead.append(head);
  table.append(thead);

  const body = document.createElement('tbody');
  for (const d of data) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = shortHourLabel(d.h);

    const tdSpeed = document.createElement('td');
    tdSpeed.textContent = `${d.v.toFixed(1)} km/h`;
    const swatch = document.createElement('i');
    swatch.style.background = speedColor(d.v);
    tdSpeed.prepend(swatch);

    const tdCond = document.createElement('td');
    tdCond.textContent = d.v < 6 ? 'Severe Crawl' : d.v < 9 ? 'Heavy Traffic' : d.v < 15 ? 'Moderate' : 'Free Flow';
    tdCond.style.color = speedColor(d.v);
    tdCond.style.fontWeight = '600';

    tr.append(th, tdSpeed, tdCond);
    body.append(tr);
  }
  table.append(body);
  host.append(table);

  if (toggle.dataset['wired'] === '1') return;
  toggle.dataset['wired'] = '1';
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    toggle.textContent = open ? 'Show the numbers' : 'Hide the numbers';
    host.hidden = open;
  });
}
