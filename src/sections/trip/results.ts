/* =====================================================================
   THE RESULT PANELS — timeline, departure advice, curve, option cards

   Everything that renders a finished JourneyPlan into the page. `render` is
   the entry point; the rest are the pieces it assembles.

   No decisions are made here. The plan arrives settled; these functions only
   choose how to say it.
   ===================================================================== */
import type { JourneyOption, JourneyPlan } from '../../core/journey/types';
import { fastestRoute, placeName } from '../../core/routing/graph';
import { hasProfileData } from '../../core/traffic/hierarchy';
import { clock, el, fmt, hourLabel, LABEL_TEXT, LEVEL_LABEL } from './format';
import { drawMap } from './map';
import { view } from './state';

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
    const row = el('li', `trip-route${option.id === view.selectedId ? ' trip-route-best' : ''}`);
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-pressed', String(option.id === view.selectedId));

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
      view.selectedId = option.id;
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
    ['Earliest checked', clock(d.earliestSensible), 'earlier departures were not evaluated'],
    ['Recommended', clock(d.recommended), `arrive ${clock(d.arrival.earliest)}–${clock(d.arrival.latest)}`],
    ['Latest within model', clock(d.latestSafe), `${fmt(d.bufferMinutes)} beyond the modeled arrival range`],
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

export function render(plan: JourneyPlan): void {
  view.current = plan;
  const all = [plan.recommended, ...plan.alternatives];
  const shown = all.find((o) => o.id === view.selectedId) ?? plan.recommended;
  view.selectedId = shown.id;

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

  if (why) why.textContent = shown.id === plan.recommended.id ? plan.explanation
    : 'Selected alternative. ' + shown.reasons.join(' ') + ' ' + shown.confidence.reasons.join(' ');

  drawTimeline(plan, shown);
  drawDeparture(shown.id === plan.recommended.id ? plan : { ...plan, departure: null });
  listOptions(plan);
  drawMap(plan, shown);

  if (plan.departure) {
    drawCurve(
      plan.departure.options.map((o) => ({
        hour: (o.departAt / 60) % 24,
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

export function showError(message: string): void {
  view.current = null;
  view.selectedId = null;
  for (const id of ['tripChips', 'tripDepart', 'tripProvenance', 'tripMap', 'tripNotices']) {
    const host = document.getElementById(id);
    if (host) host.textContent = '';
  }

  document.getElementById('tripMap')?.setAttribute('aria-label', 'No route to display');
  const advice = document.getElementById('tripDepart');
  if (advice) advice.hidden = true;
  const eyebrow = document.getElementById('tripEyebrow');
  if (eyebrow) eyebrow.textContent = 'Journey unavailable';
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

