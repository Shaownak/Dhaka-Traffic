/* =====================================================================
   THE ROUTE MAP — a schematic of the network with the journey on it

   Draws only. It is handed a finished plan and the option currently selected,
   and renders them; it never chooses anything.
   ===================================================================== */
import { PLACES, ROADS } from '../../data/network';
import type { JourneyOption, JourneyPlan } from '../../core/journey/types';
import { placeName } from '../../core/routing/graph';
import { speedColor } from '../../util';
import { fmt } from './format';


/*
 * The schematic's coordinate space.
 *
 * These are small on purpose. An SVG scales to its container, so what decides
 * legibility is the RATIO of a label to the viewBox, not its absolute size.
 * At 900 units wide in a 430 px column everything drew at 47% and a 15px label
 * landed at seven — technically present, practically unreadable. Halving the
 * viewBox doubles the effective size of every label and node without touching
 * the layout.
 *
 * The padding is asymmetric because labels are drawn to the RIGHT of their
 * junction, so the east edge needs room the west edge does not.
 */
const W = 470;
const H = 400;
const PAD_X = 26;
const PAD_RIGHT = 92;
const PAD_Y = 22;

/* ---------- the map ---------- */

export function drawMap(plan: JourneyPlan, shown: JourneyOption): void {
  const svg = document.getElementById('tripMap');
  if (!svg) return;
  svg.textContent = '';
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const xs = PLACES.map((p) => p.x);
  const ys = PLACES.map((p) => p.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const X = (x: number): number => PAD_X + ((x - minX) / (maxX - minX)) * (W - PAD_X - PAD_RIGHT);
  const Y = (y: number): number => PAD_Y + ((y - minY) / (maxY - minY)) * (H - PAD_Y * 2);
  const at = new Map(PLACES.map((p) => [p.id, { x: X(p.x), y: Y(p.y) }]));

  const ns = 'http://www.w3.org/2000/svg';
  const add = (tag: string, attrs: Record<string, string | number>): SVGElement => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
    return node;
  };

  const edgesOf = (option: JourneyOption): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < option.path.length - 1; i++) {
      set.add([option.path[i], option.path[i + 1]].sort().join('|'));
    }
    return set;
  };

  const onShown = edgesOf(shown);
  const onOther = new Set<string>();
  for (const option of [plan.recommended, ...plan.alternatives]) {
    if (option === shown) continue;
    for (const key of edgesOf(option)) onOther.add(key);
  }

  // Every road, faint; the chosen journey on top of it.
  for (const road of ROADS) {
    const a = at.get(road.a);
    const b = at.get(road.b);
    if (!a || !b) continue;
    const key = [road.a, road.b].sort().join('|');
    const isShown = onShown.has(key);
    const isOther = !isShown && onOther.has(key);
    const leg = shown.legs.find(
      (l) => [l.from, l.to].map(nameToId).sort().join('|') === key,
    );
    const kmh = leg?.kmh ?? road.freeKmh * 0.4;

    add('line', {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: isShown ? speedColor(kmh) : isOther ? 'rgba(32,19,14,.30)' : 'rgba(32,19,14,.13)',
      'stroke-width': isShown ? 6 : isOther ? 2.6 : 1.4,
      'stroke-linecap': 'round',
      'stroke-dasharray': isOther ? '5 4' : 'none',
    });
  }

  const onPath = new Set(shown.path);
  for (const place of PLACES) {
    const p = at.get(place.id);
    if (!p) continue;
    const isEnd = place.id === plan.origin.id || place.id === plan.destination.id;
    const isOn = onPath.has(place.id);

    add('circle', {
      cx: p.x, cy: p.y, r: isEnd ? 6 : isOn ? 4.2 : 2.4,
      fill: isEnd ? '#20130E' : isOn ? '#F8F3EA' : 'rgba(32,19,14,.28)',
      stroke: isEnd || isOn ? '#20130E' : 'none',
      'stroke-width': 1.8,
    });

    if (isEnd || isOn) {
      const label = add('text', {
        x: p.x + 9, y: p.y + 3.5,
        fill: '#20130E',
        'font-size': isEnd ? 12 : 10.5,
        'font-weight': isEnd ? 700 : 600,
        'paint-order': 'stroke',
        stroke: '#F8F3EA',
        'stroke-width': 3,
        'stroke-linejoin': 'round',
      });
      label.textContent = place.name;
    }
  }

  // The stop, marked where the router actually reaches it.
  if (shown.stop) {
    const junction = at.get(shown.stop.viaPlaceId);
    if (junction) {
      add('circle', {
        cx: junction.x, cy: junction.y, r: 9.5,
        fill: 'none', stroke: '#F2A310', 'stroke-width': 2.6,
      });
      const label = add('text', {
        x: junction.x + 12, y: junction.y + 15,
        fill: '#8A4B08',
        'font-size': 10.5,
        'font-weight': 700,
        'paint-order': 'stroke',
        stroke: '#F8F3EA',
        'stroke-width': 3,
        'stroke-linejoin': 'round',
      });
      label.textContent = shown.stop.name;
    }
  }

  const stopWords = shown.stop ? `, stopping at ${shown.stop.name}` : '';
  svg.setAttribute(
    'aria-label',
    `Route map. ${plan.origin.name} to ${plan.destination.name}${stopWords}: `
    + `${shown.path.map(placeName).join(', then ')}. ${fmt(shown.duration.expectedMinutes)}.`,
  );
}




const nameToIdCache = new Map<string, string>();
function nameToId(name: string): string {
  if (!nameToIdCache.size) {
    for (const p of PLACES) nameToIdCache.set(p.name, p.id);
  }
  return nameToIdCache.get(name) ?? name;
}

