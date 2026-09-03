/* =====================================================================
   PLAN A TRIP — where, when, and what it will cost you

   The useful answer is not a single number. It is the shape of the next few
   hours: leave now and it takes this long, leave at eight and it takes that
   long. So the planner returns a departure curve, the routes behind it, and
   the difference between the day you picked and the other kind of day.
   ===================================================================== */
import { PLACES, ROADS, TIME_WINDOWS } from '../../data/network';
import {
  bestDeparture,
  dayTypeOf,
  departureCurve,
  fastestRoute,
  placeName,
  routeOptions,
  type DayType,
  type Route,
  hasMeasuredTimes,
} from './trip-model';
import { speedColor } from '../../util';

const W = 900;
const H = 620;
const PAD = 54;

let fromId = 'gulshan';
let toId = 'mohammadpur';
let when = new Date();
let windowId = 'evening';

/** "47 min" or "1 h 8 min". */
function fmt(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function clock(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- the schematic ---------- */

function drawNetwork(best: Route | null, alternatives: readonly Route[], hour: number, dayType: DayType): void {
  const svg = document.getElementById('tripMap');
  if (!svg) return;
  svg.textContent = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const xs = PLACES.map((p) => p.x);
  const ys = PLACES.map((p) => p.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const X = (x: number): number => PAD + ((x - minX) / (maxX - minX)) * (W - PAD * 2);
  const Y = (y: number): number => PAD + ((y - minY) / (maxY - minY)) * (H - PAD * 2 - 20);
  const at = new Map(PLACES.map((p) => [p.id, { x: X(p.x), y: Y(p.y) }]));

  const ns = 'http://www.w3.org/2000/svg';
  const add = (tag: string, attrs: Record<string, string | number>): SVGElement => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
    return node;
  };

  const onBest = new Set<string>();
  if (best) {
    for (let i = 0; i < best.path.length - 1; i++) {
      onBest.add([best.path[i], best.path[i + 1]].sort().join('|'));
    }
  }
  const onAlt = new Set<string>();
  for (const r of alternatives.slice(1)) {
    for (let i = 0; i < r.path.length - 1; i++) {
      onAlt.add([r.path[i], r.path[i + 1]].sort().join('|'));
    }
  }

  // every road, colored by how fast it is running at this hour
  for (const road of ROADS) {
    const a = at.get(road.a);
    const b = at.get(road.b);
    if (!a || !b) continue;
    const key = [road.a, road.b].sort().join('|');
    const isBest = onBest.has(key);
    const isAlt = !isBest && onAlt.has(key);
    const kmh = road.peakKmh + (road.freeKmh - road.peakKmh)
      * (dayType === 'weekend' ? 0.55 : 0.15);

    add('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: isBest || isAlt ? speedColor(kmh) : 'rgba(32,19,14,.13)',
      'stroke-width': isBest ? 9 : isAlt ? 5 : 2.5,
      'stroke-linecap': 'round',
      opacity: isBest ? 1 : isAlt ? 0.75 : 1,
      'stroke-dasharray': isAlt ? '9 6' : 'none',
    });
  }

  for (const place of PLACES) {
    const p = at.get(place.id);
    if (!p) continue;
    const isEnd = place.id === fromId || place.id === toId;
    const isOn = best?.path.includes(place.id) ?? false;

    add('circle', {
      cx: p.x, cy: p.y, r: isEnd ? 8.5 : isOn ? 5.5 : 3.5,
      fill: isEnd ? '#20130E' : isOn ? '#F8F3EA' : 'rgba(32,19,14,.28)',
      stroke: isEnd || isOn ? '#20130E' : 'none',
      'stroke-width': 2.5,
    });

    if (isEnd || isOn) {
      const label = add('text', {
        x: p.x + 12, y: p.y + 4,
        fill: '#20130E',
        'font-size': isEnd ? 15 : 13,
        'font-weight': isEnd ? 700 : 600,
        'paint-order': 'stroke',
        stroke: '#F8F3EA',
        'stroke-width': 4,
        'stroke-linejoin': 'round',
      });
      label.textContent = place.name;
    }
  }

  svg.setAttribute(
    'aria-label',
    best
      ? `Route map. Fastest route from ${placeName(fromId)} to ${placeName(toId)} at ${clock(hour)}: `
        + best.path.map(placeName).join(', then ') + `. ${fmt(best.minutes)}.`
      : 'Route map.',
  );
}

/* ---------- the departure curve ---------- */

function drawCurve(points: readonly { hour: number; minutes: number }[], bestHour: number): void {
  const host = document.getElementById('tripCurve');
  if (!host) return;
  host.textContent = '';
  if (!points.length) return;

  const max = Math.max(...points.map((p) => p.minutes));

  for (const p of points) {
    const col = el('div', `curve-col${p.hour === bestHour ? ' curve-best' : ''}`);
    const bar = el('div', 'curve-bar');
    bar.style.height = `${(p.minutes / max) * 100}%`;
    bar.title = `${clock(p.hour)}: ${fmt(p.minutes)}`;

    col.append(
      el('span', 'curve-val', String(Math.round(p.minutes))),
      bar,
      el('span', 'curve-hour', clock(p.hour).replace(' ', '')),
    );
    host.append(col);
  }
}

/* ---------- the answer in words ---------- */

function describe(
  curve: readonly { hour: number; minutes: number }[],
  best: { hour: number; minutes: number },
  dayType: DayType,
  otherDayBest: number | null,
): void {
  const headline = document.getElementById('tripHeadline');
  const detail = document.getElementById('tripDetail');
  if (!headline || !detail) return;

  headline.textContent = '';
  headline.append(
    el('b', 'trip-when', `Leave at ${clock(best.hour)}`),
    el('span', 'trip-dur', fmt(best.minutes)),
  );

  const worst = curve.reduce((a, b) => (b.minutes > a.minutes ? b : a));
  const dayName = when.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const sentences: string[] = [
    `${placeName(fromId)} to ${placeName(toId)} on ${dayName}, a ${dayType === 'weekend' ? 'weekend' : 'working'} day.`,
  ];

  const swing = worst.minutes - best.minutes;
  if (swing >= 3) {
    sentences.push(
      `Leaving at ${clock(worst.hour)} instead would cost you ${fmt(swing)} more for the same journey.`,
    );
  } else {
    sentences.push('The journey barely changes across this window, so the departure time hardly matters.');
  }

  if (otherDayBest !== null) {
    const diff = otherDayBest - best.minutes;
    if (Math.abs(diff) >= 4) {
      sentences.push(
        dayType === 'weekend'
          ? `You picked a good day: the same trip on a working evening takes about ${fmt(otherDayBest)}.`
          : `On a Friday or Saturday the same trip takes about ${fmt(otherDayBest)}.`,
      );
    }
  }

  detail.textContent = sentences.join(' ');
}

function listRoutes(routes: readonly Route[]): void {
  const host = document.getElementById('tripRoutes');
  if (!host) return;
  host.textContent = '';

  routes.forEach((r, i) => {
    const row = el('li', `trip-route${i === 0 ? ' trip-route-best' : ''}`);

    const head = el('div', 'trip-route-head');
    head.append(
      el('b', 'trip-route-time', fmt(r.minutes)),
      el('span', 'trip-route-tag', i === 0 ? 'Fastest' : `+${fmt(r.minutes - routes[0]!.minutes)}`),
    );

    const via = r.path.slice(1, -1).map(placeName).join(' → ') || 'direct';
    row.append(
      head,
      el('div', 'trip-route-via', `via ${via}`),
      el('div', 'trip-route-meta',
        `${r.km.toFixed(1)} km · ${fmt(r.delayMinutes)} of it stuck in traffic`),
    );
    host.append(row);
  });
}

/* ---------- wiring ---------- */

function update(): void {
  const dayType = dayTypeOf(when);
  const w = TIME_WINDOWS.find((x) => x.id === windowId) ?? TIME_WINDOWS[2]!;

  const curve = departureCurve(fromId, toId, w.from, w.to, dayType);
  const best = bestDeparture(curve);
  if (!best) return;

  const routes = routeOptions(fromId, toId, best.hour, dayType, 4);
  const fastest = fastestRoute(fromId, toId, best.hour, dayType);

  const otherType: DayType = dayType === 'weekend' ? 'working' : 'weekend';
  const otherBest = bestDeparture(departureCurve(fromId, toId, w.from, w.to, otherType));

  describe(curve, best, dayType, otherBest?.minutes ?? null);
  drawCurve(curve, best.hour);
  listRoutes(routes);
  drawNetwork(fastest, routes, best.hour, dayType);
  stampTripProvenance(fastest);
}

function fillPlaces(select: HTMLSelectElement, selected: string): void {
  const sorted = [...PLACES].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of sorted) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    if (p.id === selected) opt.selected = true;
    select.append(opt);
  }
}

export function initTrip(): void {
  const from = document.getElementById('tripFrom') as HTMLSelectElement | null;
  const to = document.getElementById('tripTo') as HTMLSelectElement | null;
  const date = document.getElementById('tripDate') as HTMLInputElement | null;
  const windows = document.getElementById('tripWindow') as HTMLSelectElement | null;
  const swap = document.getElementById('tripSwap');
  if (!from || !to || !date || !windows) return;

  fillPlaces(from, fromId);
  fillPlaces(to, toId);

  for (const w of TIME_WINDOWS) {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = `${w.label} (${clock(w.from)} to ${clock(w.to)})`;
    if (w.id === windowId) opt.selected = true;
    windows.append(opt);
  }

  // default to today, in the reader's own timezone
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  date.value = iso;
  date.min = iso;
  when = new Date(`${iso}T12:00:00`);

  from.addEventListener('change', () => { fromId = from.value; update(); });
  to.addEventListener('change', () => { toId = to.value; update(); });
  windows.addEventListener('change', () => { windowId = windows.value; update(); });
  date.addEventListener('change', () => {
    if (!date.value) return;
    // midday, so a timezone offset cannot roll the date into another day
    when = new Date(`${date.value}T12:00:00`);
    update();
  });

  swap?.addEventListener('click', () => {
    [fromId, toId] = [toId, fromId];
    from.value = fromId;
    to.value = toId;
    update();
  });

  update();
}

/**
 * Say plainly which numbers the answer rests on. Once a collection run has
 * happened this flips itself; nobody has to remember to edit the copy.
 */
export function stampTripProvenance(route: Route | null): void {
  const note = document.getElementById('tripProvenance');
  if (!note) return;
  if (!route) {
    note.textContent = '';
    return;
  }
  const { measured, modeled } = route.provenance;
  note.textContent = hasMeasuredTimes() && measured > 0
    ? modeled === 0
      ? `All ${measured} legs of this route use collected journey times.`
      : `${measured} of ${measured + modeled} legs use collected journey times; the rest are modeled.`
    : 'Journey times on this route are modeled, not measured.';
}
