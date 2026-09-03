/* =====================================================================
   8. HOW DHAKA UNJAMS — the scenario board

   A stacked bar, not a gauge. Selecting an intervention pushes its own
   segment onto the baseline, so the reader sees what each one is worth
   relative to the others and how far the total still is from 25 km/h —
   the speed the same roads already reach at three in the morning.
   ===================================================================== */
import { HEADLINE, NIGHT, SOLUTIONS } from '../data/traffic';

/** Two are on at the start, so the board opens with something to read. */
const selected = new Set<string>(['mrt-network', 'bus-rationalization']);

/**
 * One existing token per intervention. The colour is identity only — it ties
 * a row to its segment in the bar — so every row states its own number too.
 */
const SEGMENT_COLORS = ['var(--teal)', 'var(--marigold)', 'var(--crimson)', 'var(--indigo)', 'var(--pink)'];

/** The bar runs from a standstill to a little past the night-time road. */
const SCALE_MAX = NIGHT.kmh + 1;

function colorFor(index: number): string {
  return SEGMENT_COLORS[index % SEGMENT_COLORS.length]!;
}

export function drawSolutions(): void {
  const host = document.getElementById('solutionsGrid');
  const track = document.getElementById('solTrack');
  const total = document.getElementById('projectedSpeedGauge');
  const sub = document.getElementById('projectedSpeedGain');
  if (!host) return;

  host.textContent = '';

  const maxGain = Math.max(...SOLUTIONS.map((s) => s.potentialGainKmh));

  /* ---------- the stacked bar ---------- */

  const paint = (): void => {
    let gain = 0;
    for (const s of SOLUTIONS) if (selected.has(s.id)) gain += s.potentialGainKmh;
    const speed = HEADLINE.kmh + gain;

    if (total) {
      total.textContent = '';
      total.append(document.createTextNode(`${speed.toFixed(1)} `));
      const unit = document.createElement('em');
      unit.textContent = 'km/h';
      total.append(unit);
    }
    if (sub) {
      sub.textContent = gain > 0
        ? `+${gain.toFixed(1)} km/h above the ${HEADLINE.kmh} km/h the city manages today`
        : `Nothing selected: the ${HEADLINE.kmh} km/h the city manages today`;
    }

    if (!track) return;
    track.textContent = '';

    const base = document.createElement('span');
    base.className = 'sol-seg sol-seg-base';
    base.style.width = `${(HEADLINE.kmh / SCALE_MAX) * 100}%`;
    base.title = `${HEADLINE.kmh} km/h today`;
    track.append(base);

    SOLUTIONS.forEach((s, i) => {
      if (!selected.has(s.id)) return;
      const seg = document.createElement('span');
      seg.className = 'sol-seg';
      seg.style.width = `${(s.potentialGainKmh / SCALE_MAX) * 100}%`;
      seg.style.background = colorFor(i);
      seg.title = `${s.title}: +${s.potentialGainKmh} km/h`;
      track.append(seg);
    });

    const goal = document.createElement('span');
    goal.className = 'sol-goal';
    goal.style.left = `${(NIGHT.kmh / SCALE_MAX) * 100}%`;
    track.append(goal);
  };

  /* ---------- the interventions ---------- */

  SOLUTIONS.forEach((s, i) => {
    const on = selected.has(s.id);

    // a real button, so the browser gives us the role, the keyboard and the
    // focus ring for free
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sol-row';
    row.setAttribute('aria-pressed', String(on));
    row.style.setProperty('--seg', colorFor(i));

    const mark = document.createElement('span');
    mark.className = 'sol-mark';
    mark.setAttribute('aria-hidden', 'true');

    const body = document.createElement('span');
    body.className = 'sol-body';

    const title = document.createElement('span');
    title.className = 'sol-title';
    title.textContent = s.title;

    const desc = document.createElement('span');
    desc.className = 'sol-desc';
    desc.textContent = s.summary;

    const status = document.createElement('span');
    status.className = 'sol-status';
    status.textContent = s.status;

    body.append(title, desc, status);

    const metric = document.createElement('span');
    metric.className = 'sol-metric';

    const gain = document.createElement('span');
    gain.className = 'sol-gain';
    gain.textContent = `+${s.potentialGainKmh.toFixed(1)}`;

    const unit = document.createElement('span');
    unit.className = 'sol-unit';
    unit.textContent = 'km/h';

    // the bar carries the magnitude the number states
    const mag = document.createElement('span');
    mag.className = 'sol-mag';
    const fill = document.createElement('i');
    fill.style.width = `${(s.potentialGainKmh / maxGain) * 100}%`;
    mag.append(fill);

    metric.append(gain, unit, mag);
    row.append(mark, body, metric);

    row.addEventListener('click', () => {
      const nowOn = !selected.has(s.id);
      if (nowOn) selected.add(s.id);
      else selected.delete(s.id);
      row.setAttribute('aria-pressed', String(nowOn));
      paint();
    });

    host.append(row);
  });

  paint();
}
