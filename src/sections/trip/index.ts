/* =====================================================================
   PLAN A TRIP — the interface over the journey planner

   This file draws things. It does not decide anything.

   Every number on screen arrives inside a JourneyPlan that the core produced,
   and the two input modes — the form and the sentence box — build the same
   JourneyRequest and call the same planJourney. That is what stops the two
   modes, and the HTTP API beside them, from quietly answering differently.
   ===================================================================== */
import { PLACES, ROADS } from '../../data/network';
import { PREFERENCES, type PreferenceId } from '../../data/intelligence';
import { planJourney } from '../../core/journey/planner';
import { parseJourneyText } from '../../core/nl/parse';
import {
  JourneyError,
  type JourneyOption,
  type JourneyPlan,
  type JourneyRequest,
  type StopConstraint,
} from '../../core/journey/types';
import type { PlaceKind } from '../../core/places/provider';
import { fastestRoute, placeName } from '../../core/routing/graph';
import { hasProfileData } from '../../core/traffic/hierarchy';
import { speedColor } from '../../util';

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

/* ---------- what the reader has asked for ---------- */

interface FormState {
  fromId: string;
  toId: string;
  date: Date;
  departMinutes: number;
  preference: PreferenceId;
  deadlineOn: boolean;
  deadlineMinutes: number;
  stopOn: boolean;
  stopKinds: PlaceKind[];
  stopPosition: number;
  stopDwell: number;
}

const state: FormState = {
  fromId: 'gulshan',
  toId: 'mirpur10',
  date: new Date(),
  departMinutes: 17 * 60,
  preference: 'BALANCED',
  deadlineOn: false,
  deadlineMinutes: 19 * 60,
  stopOn: false,
  stopKinds: ['restaurant', 'cafe', 'fast_food'],
  stopPosition: 0.5,
  stopDwell: 45,
};

/** The plan currently on screen, so a route card can highlight itself. */
let current: JourneyPlan | null = null;
let selectedId: string | null = null;
/** Guards against an older plan landing after a newer one. */
let generation = 0;

/* ---------- formatting ---------- */

function fmt(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function clock(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12AM';
  if (h < 12) return `${h}AM`;
  if (h === 12) return '12PM';
  return `${h - 12}PM`;
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

const LEVEL_LABEL: Record<string, string> = {
  FREE: 'Clear', LIGHT: 'Light', MODERATE: 'Moderate', HEAVY: 'Heavy', SEVERE: 'Severe',
};

const LABEL_TEXT: Record<string, string> = {
  RECOMMENDED: 'Recommended',
  FASTEST: 'Fastest',
  MOST_RELIABLE: 'Most reliable',
  SHORTEST: 'Shortest',
  LEAST_TRAFFIC: 'Least traffic',
  BEST_WITH_STOP: 'Best with a stop',
};

/* ---------- the map ---------- */

function drawMap(plan: JourneyPlan, shown: JourneyOption): void {
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

/* ---------- the timeline ---------- */

function drawTimeline(plan: JourneyPlan, option: JourneyOption): void {
  const host = document.getElementById('tripTimeline');
  if (!host) return;
  host.textContent = '';

  const steps: { time: string; title: string; detail: string; kind: string }[] = [
    {
      time: clock(plan.departAt),
      title: `Leave ${plan.origin.name}`,
      detail: plan.dayType === 'weekend' ? 'a weekend day' : 'a working day',
      kind: 'start',
    },
  ];

  if (option.stop) {
    const s = option.stop;
    steps.push({
      time: clock(s.arriveAt),
      title: `Reach ${s.name}`,
      detail: `${Math.round(s.position * 100)}% of the way, via ${s.viaPlaceName}`
        + (s.accessKm > 0.15 ? ` (${s.accessKm.toFixed(1)} km from the junction)` : ''),
      kind: 'stop',
    });
    steps.push({
      time: clock(s.departAt),
      title: 'Move on',
      detail: `after ${fmt(s.dwellMinutes)}`,
      kind: 'resume',
    });
  }

  steps.push({
    time: `${clock(option.arrival.earliest)} – ${clock(option.arrival.latest)}`,
    title: `Arrive ${plan.destination.name}`,
    detail: `expected ${clock(option.arrival.expected)}`,
    kind: 'end',
  });

  for (const step of steps) {
    const row = el('div', `tl-step tl-${step.kind}`);
    row.append(
      el('span', 'tl-time', step.time),
      el('span', 'tl-title', step.title),
      el('span', 'tl-detail', step.detail),
    );
    host.append(row);
  }
}

/* ---------- the departure curve ---------- */

function drawCurve(
  points: readonly { hour: number; minutes: number }[],
  bestHour: number,
  title: string,
): void {
  const host = document.getElementById('tripCurve');
  const heading = document.getElementById('tripCurveTitle');
  if (heading) heading.textContent = title;
  if (!host) return;
  host.textContent = '';
  if (!points.length) return;

  const max = Math.max(...points.map((p) => p.minutes));
  for (const p of points) {
    const col = el('div', `curve-col${p.hour === bestHour ? ' curve-best' : ''}`);
    const bar = el('div', 'curve-bar');
    bar.style.height = `${(p.minutes / max) * 100}%`;
    bar.title = `${hourLabel(p.hour)}: ${fmt(p.minutes)}`;
    col.append(
      el('span', 'curve-val', String(Math.round(p.minutes))),
      bar,
      el('span', 'curve-hour', hourLabel(p.hour)),
    );
    host.append(col);
  }
}

/* ---------- the option cards ---------- */

function listOptions(plan: JourneyPlan): void {
  const host = document.getElementById('tripRoutes');
  if (!host) return;
  host.textContent = '';

  const all = [plan.recommended, ...plan.alternatives];
  const best = plan.recommended;

  all.forEach((option) => {
    const row = el('li', `trip-route${option.id === selectedId ? ' trip-route-best' : ''}`);
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-pressed', String(option.id === selectedId));

    const head = el('div', 'trip-route-head');
    head.append(el('b', 'trip-route-time', fmt(option.duration.expectedMinutes)));
    for (const label of option.labels) {
      head.append(el('span', 'trip-route-tag', LABEL_TEXT[label] ?? label));
    }
    if (!option.labels.length) {
      // A signed number here reads as nonsense ("-34 min"). Say which way.
      const gap = option.duration.expectedMinutes - best.duration.expectedMinutes;
      head.append(el('span', 'trip-route-tag',
        Math.abs(gap) < 0.5 ? 'same time'
          : gap > 0 ? `${fmt(gap)} longer`
            : `${fmt(-gap)} quicker`));
    }
    head.append(el('span', 'trip-score', option.score.toFixed(0)));

    const via = option.path.slice(1, -1).map(placeName).join(' → ') || 'direct';

    row.append(
      head,
      el('div', 'trip-route-via', `via ${via}`),
      el('div', 'trip-route-range',
        `${fmt(option.duration.bestMinutes)} to ${fmt(option.duration.worstMinutes)}, `
        + `arriving ${clock(option.arrival.earliest)}–${clock(option.arrival.latest)}`),
    );

    if (option.stop) {
      const s = option.stop;
      const stop = el('div', 'trip-route-stop');
      stop.append(
        el('b', '', s.name),
        el('span', '', ` · ${s.kind.replace('_', ' ')}${s.cuisine ? ` · ${s.cuisine}` : ''}`),
        el('span', ` trip-open trip-open-${s.open}`,
          s.open === 'open' ? 'stated open' : s.open === 'closed' ? 'stated closed' : 'hours unknown'),
      );
      row.append(stop);
      row.append(el('div', 'trip-route-meta',
        s.detourMinutes < -0.5
          ? `Saves ${fmt(-s.detourMinutes)} of driving — you rejoin the road after the worst of it.`
          : s.detourMinutes <= 0.5
            ? 'Adds no extra driving.'
            : `Adds ${fmt(s.detourMinutes)} of driving.`));
    }

    const stats = el('div', 'trip-route-stats');
    const a = option.assessment;
    for (const [label, value, tone] of [
      ['Traffic', LEVEL_LABEL[a.level] ?? a.level, a.level.toLowerCase()],
      ['Reliability', `${a.reliability} · ${a.reliabilityLabel}`, ''],
      ['Confidence', `${option.confidence.level.toLowerCase()}`, `conf-${option.confidence.level.toLowerCase()}`],
    ] as const) {
      const stat = el('span', `trip-stat${tone ? ` tone-${tone}` : ''}`);
      stat.append(el('em', 'trip-stat-label', label), document.createTextNode(value));
      stats.append(stat);
    }
    row.append(stats);
    row.append(el('div', 'trip-route-meta',
      `${option.km.toFixed(1)} km · ${option.reasons.join(', ')}`));

    const choose = (): void => {
      selectedId = option.id;
      render(plan);
    };
    row.addEventListener('click', choose);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose();
      }
    });

    host.append(row);
  });
}

/* ---------- departure advice ---------- */

function drawDeparture(plan: JourneyPlan): void {
  const host = document.getElementById('tripDepart');
  if (!host) return;
  host.textContent = '';
  const d = plan.departure;
  if (!d) {
    host.hidden = true;
    return;
  }
  host.hidden = false;

  host.append(el('h3', 'result-title', 'When to leave'));
  const grid = el('div', 'depart-grid');
  for (const [label, value, note] of [
    ['Earliest sensible', clock(d.earliestSensible), 'no gain in leaving before this'],
    ['Recommended', clock(d.recommended), `arrive ${clock(d.arrival.earliest)}–${clock(d.arrival.latest)}`],
    ['Latest safe', clock(d.latestSafe), `${fmt(d.bufferMinutes)} spare at the recommended time`],
  ] as const) {
    const cell = el('div', `depart-cell${label === 'Recommended' ? ' depart-best' : ''}`);
    cell.append(
      el('span', 'depart-label', label),
      el('b', 'depart-value', value),
      el('span', 'depart-note', note),
    );
    grid.append(cell);
  }
  host.append(grid);
}

/* ---------- assembling the answer ---------- */

function render(plan: JourneyPlan): void {
  current = plan;
  const all = [plan.recommended, ...plan.alternatives];
  const shown = all.find((o) => o.id === selectedId) ?? plan.recommended;
  selectedId = shown.id;

  const eyebrow = document.getElementById('tripEyebrow');
  const headline = document.getElementById('tripHeadline');
  const detail = document.getElementById('tripDetail');
  const chips = document.getElementById('tripChips');
  const why = document.getElementById('tripWhy');
  const provenance = document.getElementById('tripProvenance');
  const notices = document.getElementById('tripNotices');

  if (eyebrow) {
    eyebrow.textContent = shown === plan.recommended
      ? 'Recommended journey'
      : 'Selected alternative';
  }

  if (headline) {
    headline.textContent = '';
    // Duration leads; the departure is the qualifier. CSS orders them, so the
    // reading order stays sensible for a screen reader either way.
    headline.append(
      el('span', 'trip-dur', fmt(shown.duration.expectedMinutes)),
      el('b', 'trip-when',
        plan.departure ? `leave by ${clock(plan.departAt)}` : `leave at ${clock(plan.departAt)}`),
    );
  }

  if (detail) {
    const dayName = plan.dayType === 'weekend' ? 'weekend' : 'working';
    const stopWords = shown.stop ? `, stopping at ${shown.stop.name}` : '';
    detail.textContent =
      `${plan.origin.name} to ${plan.destination.name}${stopWords} on a ${dayName} day. `
      + `Arriving between ${clock(shown.arrival.earliest)} and ${clock(shown.arrival.latest)}.`;
  }

  if (chips) {
    chips.textContent = '';
    const a = shown.assessment;
    const rows: [string, string, string][] = [
      ['Distance', `${shown.km.toFixed(1)} km`, ''],
      ['Traffic', LEVEL_LABEL[a.level] ?? a.level, `chip-${a.level.toLowerCase()}`],
      ['Reliability', a.reliabilityLabel, ''],
      ['Confidence', shown.confidence.level.toLowerCase(), `chip-${shown.confidence.level.toLowerCase()}`],
    ];
    if (shown.stop) {
      rows.push(['Detour', shown.stop.detourMinutes < -0.5
        ? `${fmt(-shown.stop.detourMinutes)} saved`
        : shown.stop.detourMinutes <= 0.5 ? 'none' : fmt(shown.stop.detourMinutes), '']);
    }
    for (const [label, value, tone] of rows) {
      const chip = el('span', `chip${tone ? ` ${tone}` : ''}`);
      chip.append(el('em', '', label), document.createTextNode(value));
      chips.append(chip);
    }
  }

  if (why) why.textContent = plan.explanation;

  drawTimeline(plan, shown);
  drawDeparture(plan);
  listOptions(plan);
  drawMap(plan, shown);

  if (plan.departure) {
    drawCurve(
      plan.departure.options.map((o) => ({
        hour: Math.floor(o.departAt / 60) % 24,
        minutes: o.travelMinutes,
      })),
      Math.floor(plan.departAt / 60) % 24,
      'Travel time by departure',
    );
  } else {
    drawCurve(hourlyShape(plan), Math.floor(plan.departAt / 60) % 24, 'If you leave at');
  }

  if (provenance) {
    const measured = shown.confidence.coverage;
    provenance.textContent = hasProfileData() && measured > 0
      ? measured >= 1
        ? 'Every leg of this route uses collected journey times.'
        : `${Math.round(measured * 100)}% of this route by distance uses collected journey times; the rest is modeled.`
      : 'Journey times on this route are modeled, not measured.';
  }

  if (notices) notices.textContent = plan.notices.join(' ');
}

/**
 * How the direct drive changes across the hours either side of departure.
 *
 * Deliberately the stop-free journey, whatever option is selected: this chart
 * answers "does the time I leave matter", and holding the route constant is
 * what makes the bars comparable. Mixing a stop into some bars and not others
 * would make the shape unreadable.
 */
function hourlyShape(plan: JourneyPlan): { hour: number; minutes: number }[] {
  const points: { hour: number; minutes: number }[] = [];
  const from = Math.max(0, Math.floor(plan.departAt / 60) - 3);
  for (let h = from; h <= from + 7 && h < 24; h++) {
    const route = fastestRoute(plan.origin.id, plan.destination.id, h, plan.dayType);
    if (route) points.push({ hour: h, minutes: route.minutes });
  }
  return points;
}

/* ---------- errors ---------- */

function showError(message: string): void {
  const headline = document.getElementById('tripHeadline');
  const detail = document.getElementById('tripDetail');
  const why = document.getElementById('tripWhy');
  const routes = document.getElementById('tripRoutes');
  const timeline = document.getElementById('tripTimeline');
  if (headline) {
    headline.textContent = '';
    headline.append(el('b', 'trip-when', 'No journey found'));
  }
  if (detail) detail.textContent = message;
  if (why) why.textContent = '';
  if (routes) routes.textContent = '';
  if (timeline) timeline.textContent = '';
  drawCurve([], -1, 'If you leave at');
}

/* ---------- running a plan ---------- */

function requestFromState(): JourneyRequest {
  const request: JourneyRequest = {
    origin: state.fromId,
    destination: state.toId,
    date: state.date,
    preference: state.preference,
  };
  if (state.deadlineOn) request.arriveBy = state.deadlineMinutes;
  else request.departAt = state.departMinutes;

  if (state.stopOn) {
    const stop: StopConstraint = {
      kinds: state.stopKinds,
      position: state.stopPosition,
      dwellMinutes: state.stopDwell,
    };
    request.stop = stop;
  }
  return request;
}

async function run(request: JourneyRequest): Promise<void> {
  const mine = ++generation;
  try {
    const plan = await planJourney(request);
    // a later request may have been fired while this one was resolving
    if (mine !== generation) return;
    selectedId = plan.recommended.id;
    render(plan);
  } catch (error) {
    if (mine !== generation) return;
    if (error instanceof JourneyError) showError(error.message);
    else showError('Something went wrong planning that journey.');
  }
}

function update(): void {
  void run(requestFromState());
}

/* ---------- wiring ---------- */

function fillPlaces(select: HTMLSelectElement, selected: string): void {
  const sorted = [...PLACES].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of sorted) {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = p.name;
    if (p.id === selected) option.selected = true;
    select.append(option);
  }
}

function minutesFromTime(value: string): number | null {
  const [h, m] = value.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h! * 60 + m!;
}

export function initTrip(): void {
  const from = document.getElementById('tripFrom') as HTMLSelectElement | null;
  const to = document.getElementById('tripTo') as HTMLSelectElement | null;
  const date = document.getElementById('tripDate') as HTMLInputElement | null;
  const time = document.getElementById('tripTime') as HTMLInputElement | null;
  const pref = document.getElementById('tripPreference') as HTMLSelectElement | null;
  if (!from || !to || !date || !time) return;

  fillPlaces(from, state.fromId);
  fillPlaces(to, state.toId);

  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  date.value = iso;
  date.min = iso;
  // midday, so a timezone offset cannot roll the date into another day
  state.date = new Date(`${iso}T12:00:00`);

  from.addEventListener('change', () => { state.fromId = from.value; update(); });
  to.addEventListener('change', () => { state.toId = to.value; update(); });
  date.addEventListener('change', () => {
    if (!date.value) return;
    state.date = new Date(`${date.value}T12:00:00`);
    update();
  });
  time.addEventListener('change', () => {
    const minutes = minutesFromTime(time.value);
    if (minutes !== null) state.departMinutes = minutes;
    update();
  });

  document.getElementById('tripSwap')?.addEventListener('click', () => {
    [state.fromId, state.toId] = [state.toId, state.fromId];
    from.value = state.fromId;
    to.value = state.toId;
    update();
  });

  if (pref) {
    for (const p of PREFERENCES) {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.label;
      option.title = p.blurb;
      if (p.id === state.preference) option.selected = true;
      pref.append(option);
    }
    pref.addEventListener('change', () => {
      state.preference = pref.value as PreferenceId;
      update();
    });
  }

  /* deadline */
  const deadlineOn = document.getElementById('tripDeadlineOn') as HTMLInputElement | null;
  const deadlineTime = document.getElementById('tripDeadlineTime') as HTMLInputElement | null;
  if (deadlineOn && deadlineTime) {
    deadlineOn.addEventListener('change', () => {
      state.deadlineOn = deadlineOn.checked;
      deadlineTime.disabled = !state.deadlineOn;
      update();
    });
    deadlineTime.addEventListener('change', () => {
      const minutes = minutesFromTime(deadlineTime.value);
      if (minutes !== null) state.deadlineMinutes = minutes;
      update();
    });
  }

  /* stop */
  const stopOn = document.getElementById('tripStopOn') as HTMLInputElement | null;
  const stopKind = document.getElementById('tripStopKind') as HTMLSelectElement | null;
  const stopWhere = document.getElementById('tripStopWhere') as HTMLSelectElement | null;
  const stopDwell = document.getElementById('tripStopDwell') as HTMLSelectElement | null;
  if (stopOn && stopKind && stopWhere && stopDwell) {
    const setEnabled = (): void => {
      for (const control of [stopKind, stopWhere, stopDwell]) control.disabled = !state.stopOn;
    };
    stopOn.addEventListener('change', () => {
      state.stopOn = stopOn.checked;
      setEnabled();
      update();
    });
    stopKind.addEventListener('change', () => {
      state.stopKinds = stopKind.value.split(',') as PlaceKind[];
      update();
    });
    stopWhere.addEventListener('change', () => {
      state.stopPosition = Number(stopWhere.value);
      update();
    });
    stopDwell.addEventListener('change', () => {
      state.stopDwell = Number(stopDwell.value);
      update();
    });
    setEnabled();
  }

  /* the two modes */
  const modeForm = document.getElementById('tripModeForm');
  const modeText = document.getElementById('tripModeText');
  const panelForm = document.getElementById('tripFormPanel');
  const panelText = document.getElementById('tripTextPanel');

  const showMode = (which: 'form' | 'text'): void => {
    if (!modeForm || !modeText || !panelForm || !panelText) return;
    const isText = which === 'text';
    panelForm.hidden = isText;
    panelText.hidden = !isText;
    modeForm.classList.toggle('is-on', !isText);
    modeText.classList.toggle('is-on', isText);
    modeForm.setAttribute('aria-selected', String(!isText));
    modeText.setAttribute('aria-selected', String(isText));
  };
  modeForm?.addEventListener('click', () => showMode('form'));
  modeText?.addEventListener('click', () => showMode('text'));

  /* the sentence box */
  const text = document.getElementById('tripText') as HTMLInputElement | null;
  const go = document.getElementById('tripTextGo');
  const read = document.getElementById('tripRead');

  const runText = (): void => {
    if (!text) return;
    const parsed = parseJourneyText(text.value, new Date());

    if (read) {
      read.textContent = parsed.ok
        ? `Read as: ${parsed.understood.join(', ')}.`
          + (parsed.problems.length ? ` ${parsed.problems.join(' ')}` : '')
        : parsed.problems.join(' ');
      read.className = `pf-read${parsed.ok ? '' : ' pf-read-bad'}`;
    }
    if (!parsed.ok || !parsed.request) return;

    // Mirror the sentence back into the form, so the two modes stay one state.
    const intent = parsed.request;
    state.fromId = intent.origin;
    state.toId = intent.destination;
    state.date = new Date(`${intent.date}T12:00:00`);
    state.deadlineOn = intent.arriveBy !== undefined;
    if (intent.arriveBy !== undefined) state.deadlineMinutes = intent.arriveBy;
    if (intent.departAt !== undefined) state.departMinutes = intent.departAt;
    if (intent.preference) state.preference = intent.preference;
    state.stopOn = Boolean(intent.stop);
    if (intent.stop) {
      state.stopKinds = [...intent.stop.kinds];
      state.stopPosition = intent.stop.position;
      state.stopDwell = intent.stop.dwellMinutes;
    }

    from.value = state.fromId;
    to.value = state.toId;
    if (pref) pref.value = state.preference;
    if (deadlineOn && deadlineTime) {
      deadlineOn.checked = state.deadlineOn;
      deadlineTime.disabled = !state.deadlineOn;
    }
    if (stopOn) stopOn.checked = state.stopOn;
    for (const control of [stopKind, stopWhere, stopDwell]) {
      if (control) control.disabled = !state.stopOn;
    }

    update();
  };

  go?.addEventListener('click', runText);
  text?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runText();
    }
  });

  update();
}

/** Exposed for the sources section, which reports what the planner rests on. */
export function currentPlan(): JourneyPlan | null {
  return current;
}
