/* =====================================================================
   6. YOUR YEAR — 365 squares, and the days you lose sitting still
   Includes Preset Corridors and an Interactive Personal Commute Calculator.
   ===================================================================== */
import { select } from 'd3-selection';
import 'd3-transition';
import { CONGESTION_SHARE, EQUIVALENTS, ROUTES, WORK_YEAR } from '../data/traffic';
import { CREAM, REDUCED } from '../util';

interface Cell {
  i: number;
  hit: boolean;
  x: number;
  y: number;
}

let mode: 'preset' | 'custom' = 'preset';
let pick = 0;
let customMinutes = 60;
let customDaysPerWeek = 5;
let customIncomeBdt = 45000;
let seen = false;

export function selectCostRoute(name: string): void {
  const idx = ROUTES.findIndex((r) => r.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(r.name.toLowerCase()));
  if (idx !== -1) {
    pick = idx;
    mode = 'preset';
    updateModeTabs();
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.picker button'));
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === pick)));
    drawYear(true);
  }
}

function updateModeTabs(): void {
  const presetTab = document.getElementById('costTabPreset');
  const customTab = document.getElementById('costTabCustom');
  const presetPanel = document.getElementById('costPresetPanel');
  const customPanel = document.getElementById('costCustomPanel');

  if (presetTab && customTab && presetPanel && customPanel) {
    presetTab.setAttribute('aria-pressed', String(mode === 'preset'));
    customTab.setAttribute('aria-pressed', String(mode === 'custom'));
    presetPanel.hidden = mode !== 'preset';
    customPanel.hidden = mode !== 'custom';
  }
}

/** "1 h 35 m", or "48 m". */
function duration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} m` : `${h} h`;
}

/**
 * How many days a year this reader actually travels. Friday and Saturday are
 * the weekend, so the preset corridors spread their hours over 260 days rather
 * than 365; the calculator follows whatever the reader picks.
 */
function commutingDays(): number {
  return mode === 'custom'
    ? customDaysPerWeek * WORK_YEAR.weeksPerYear
    : WORK_YEAR.workingDaysPerYear;
}

function getActiveLostHours(): { hours: number; label: string; name: string } {
  const days = commutingDays();

  if (mode === 'preset') {
    const route = ROUTES[pick]!;
    const perDay = (route.hours * 60) / days;
    return {
      hours: route.hours,
      label: `${route.hours} hours a year on ${route.name} — ${duration(perDay)} of every working day you travel it.`,
      name: route.name,
    };
  }

  // Round trip, over the reader's own commuting days.
  const annualCommuteHours = (customMinutes * 2 * customDaysPerWeek * WORK_YEAR.weeksPerYear) / 60;
  const lostHours = Math.round(annualCommuteHours * CONGESTION_SHARE);
  const perDay = (lostHours * 60) / days;

  return {
    hours: lostHours,
    label: `A ${customMinutes}-minute commute each way, ${customDaysPerWeek} days a week, is `
      + `${Math.round(annualCommuteHours)} hours a year on the road. About ${lostHours} of those hours `
      + `are congestion rather than distance — ${duration(perDay)} of every commuting day.`,
    name: 'your daily commute',
  };
}

export function drawYear(animate: boolean): void {
  const svg = select<SVGSVGElement, unknown>('#year');
  if (svg.empty()) return;
  svg.selectAll('*').remove();

  const { hours, label, name } = getActiveLostHours();
  const total = commutingDays();
  const cols = 25;
  const rows = Math.ceil(total / cols);
  const cell = 1000 / cols;
  const s = cell * 0.6;
  const rad = 3;

  // A square is a day you travel, so a marked square is a working day's worth
  // of delay — eight hours, not twenty-four.
  const lostDays = Math.min(total, Math.max(1, Math.round(hours / WORK_YEAR.workingDayHours)));

  // Spread the lost days evenly. The jitter is clamped inside each day's own
  // slot, so two marks can never land on the same square and the grid always
  // paints exactly as many squares as the headline claims.
  const step = total / lostDays;
  const maxJitter = Math.max(0, (step - 1) / 2);
  const marked = new Set<number>();
  for (let k = 0; k < lostDays; k++) {
    const jitter = Math.max(-maxJitter, Math.min(maxJitter, ((k * 37) % 11) - 5));
    let idx = Math.max(0, Math.min(total - 1, Math.round((k + 0.5) * step + jitter)));
    // if rounding or the clamp lands on a square already taken, take the next
    // free one, so the grid always paints exactly `lostDays` squares
    while (marked.has(idx) && idx < total - 1) idx++;
    while (marked.has(idx) && idx > 0) idx--;
    marked.add(idx);
  }

  // keep the squares square whatever the day count
  const height = rows * cell;
  svg.attr('viewBox', `0 0 1000 ${height}`);
  svg.style('aspect-ratio', `1000 / ${height}`);

  const lastRow = total - (rows - 1) * cols;
  const inset = ((cols - lastRow) * cell) / 2;

  const cells: Cell[] = [];
  for (let i = 0; i < total; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    cells.push({
      i,
      hit: marked.has(i),
      x: c * cell + (cell - s) / 2 + (r === rows - 1 ? inset : 0),
      y: r * cell + (cell - s) / 2,
    });
  }

  const sel = svg.selectAll<SVGRectElement, Cell>('rect').data(cells).join('rect')
    .attr('x', (d) => d.x).attr('y', (d) => d.y).attr('width', s).attr('height', s).attr('rx', rad)
    .attr('fill', 'rgba(246,238,224,0.20)');

  const roll = animate && !REDUCED;
  sel.filter((d) => d.hit)
    .attr('fill', roll ? 'rgba(246,238,224,0.22)' : CREAM)
    .transition().duration(roll ? 12 : 0)
    .delay((_d, i) => (roll ? i * 26 : 0))
    .attr('fill', CREAM);

  const daysEl = document.getElementById('days');
  const unitEl = document.getElementById('unit');
  const hintEl = document.getElementById('hint');
  const capEl = document.getElementById('yearCap');
  if (daysEl) daysEl.textContent = String(lostDays);
  if (unitEl) unitEl.textContent = lostDays === 1 ? 'working day a year' : 'working days a year';
  if (hintEl) hintEl.textContent = label;
  if (capEl) {
    capEl.textContent = mode === 'custom'
      ? `${total} commuting days a year. The pale squares are yours to lose.`
      : `${total} working days a year, Sunday to Thursday. The pale squares are yours to lose.`;
  }

  // Update opportunity and economic equivalents
  const booksCount = Math.max(1, Math.round(hours / EQUIVALENTS.bookHours));
  const moviesCount = Math.max(1, Math.round(hours / EQUIVALENTS.filmHours));
  // a month's working hours, on the same 5-day week the grid uses
  const monthlyHours = (WORK_YEAR.workingDaysPerYear / 12) * WORK_YEAR.workingDayHours;
  const hourlyWage = customIncomeBdt / monthlyHours;
  const moneyLostBdt = Math.round(hours * hourlyWage);

  const booksEl = document.getElementById('equivBooks');
  const moviesEl = document.getElementById('equivMovies');
  const moneyEl = document.getElementById('equivMoney');
  if (booksEl) booksEl.textContent = String(booksCount);
  if (moviesEl) moviesEl.textContent = String(moviesCount);
  if (moneyEl) {
    // lakh/crore grouping, to match the way the rest of the page counts
    moneyEl.textContent = `Tk ${moneyLostBdt.toLocaleString('en-IN')}`;
    // the salary is an input on the calculator tab; say which one is in play
    const lab = moneyEl.nextElementSibling;
    if (lab) {
      lab.textContent = `Those hours priced at a Tk ${customIncomeBdt.toLocaleString('en-IN')} monthly salary`
        + ` (${Math.round(monthlyHours)} working hours a month)`;
    }
  }

  svg.attr(
    'aria-label',
    `A grid of ${total} squares, one for every day travelled in a year. ${lostDays} are highlighted: `
      + `the ${WORK_YEAR.workingDayHours}-hour working days' worth of delay on ${name}.`,
  );
}

export function initCost(): void {
  // Preset buttons
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.picker button'));
  for (const b of buttons) {
    b.addEventListener('click', () => {
      pick = Number(b.dataset['i'] ?? 0);
      for (const o of buttons) o.setAttribute('aria-pressed', String(o === b));
      drawYear(seen);
    });
  }

  // Mode switcher tabs
  const presetTab = document.getElementById('costTabPreset');
  const customTab = document.getElementById('costTabCustom');
  if (presetTab && customTab) {
    presetTab.addEventListener('click', () => {
      mode = 'preset';
      updateModeTabs();
      drawYear(seen);
    });
    customTab.addEventListener('click', () => {
      mode = 'custom';
      updateModeTabs();
      drawYear(seen);
    });
  }

  // Custom commute calculator controls
  const minSlider = document.getElementById('commuteMinutesSlider') as HTMLInputElement | null;
  const minVal = document.getElementById('commuteMinutesVal');
  if (minSlider) {
    minSlider.addEventListener('input', () => {
      customMinutes = Number(minSlider.value);
      if (minVal) minVal.textContent = `${customMinutes} mins`;
      drawYear(seen);
    });
  }

  const daysSelect = document.getElementById('commuteDaysSelect') as HTMLSelectElement | null;
  if (daysSelect) {
    daysSelect.addEventListener('change', () => {
      customDaysPerWeek = Number(daysSelect.value);
      drawYear(seen);
    });
  }

  const incomeInput = document.getElementById('commuteIncomeInput') as HTMLInputElement | null;
  if (incomeInput) {
    incomeInput.addEventListener('input', () => {
      customIncomeBdt = Math.max(1000, Number(incomeInput.value) || 45000);
      drawYear(seen);
    });
  }

  // Copy stat button
  const copyBtn = document.getElementById('copyStatBtn') as HTMLButtonElement | null;
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const { hours, name } = getActiveLostHours();
      const lostDays = Math.max(1, Math.round(hours / WORK_YEAR.workingDayHours));
      const text = `I lose ${hours} hours a year to Dhaka traffic on ${name} — the equivalent of `
        + `${lostDays} working days, spread over ${commutingDays()} commuting days. `
        + `(Source: Seven Kilometers an Hour)`;
      void navigator.clipboard.writeText(text).then(() => {
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.textContent = original;
        }, 2200);
      });
    });
  }

  drawYear(false);
}

export function revealYear(): void {
  seen = true;
  drawYear(true);
}
