/* =====================================================================
   METHODOLOGY — how every number on this page was arrived at

   Rendered from the DATASETS ledger in data/traffic.ts, so the page cannot
   claim a sourcing story that differs from the one feeding the charts. If a
   dataset is upgraded from modeled to measured, this section changes with it.

   Presented as a table you can scan, with the reasoning behind disclosures.
   All of it matters, but a methodology longer than the story it explains reads
   as defensive, and nobody reads nine essays to check one number. The status of
   every dataset is visible at a glance; the argument is one click away.
   ===================================================================== */
import { COLOR_AUDIT, DATASETS, SOURCES, WORK_YEAR, type Dataset } from '../data/traffic';

/** Sentences do not open with a numeral. */
const SPELLED: Record<number, string> = {
  1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six',
  7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Eleven', 12: 'Twelve',
};

const LABEL: Record<Dataset['provenance'], string> = {
  measured: 'Measured',
  derived: 'Derived',
  modeled: 'Modeled',
};

const BLURB: Record<Dataset['provenance'], string> = {
  measured: 'Published by a named institution and transcribed as stated.',
  derived: 'Computed on this page from measured inputs or from what the reader enters.',
  modeled: 'Not observed. Built to be plausible, and not citable as a finding.',
};

function tag(p: Dataset['provenance']): HTMLElement {
  const el = document.createElement('span');
  el.className = `method-tag method-tag-${p}`;
  el.textContent = LABEL[p];
  el.title = BLURB[p];
  return el;
}

function limitations(): string[] {
  return [
    `The working year is ${WORK_YEAR.weeksPerYear} weeks of ${WORK_YEAR.daysPerWeek} days — ${WORK_YEAR.workingDaysPerYear} travelling days, with ${WORK_YEAR.weekend} treated as the weekend. Public holidays are not deducted, so per-day figures are conservative by roughly eight percent.`,
    'A city-wide average speed and a peak-hour average speed measure different things. Where both appear on one axis, each point is labeled with its own metric and they are not connected as a single series.',
    'Corridor geometry is topological. Positions are laid out for legibility, not surveyed, and distances on the map carry no meaning.',
    `The congestion color ramp was audited under simulated red-green color blindness: worst separation ${COLOR_AUDIT.worstDeuteranopia} for deuteranopia and ${COLOR_AUDIT.worstProtanopia} for protanopia, against a floor of ${COLOR_AUDIT.threshold}. ${COLOR_AUDIT.note}`,
    'The street simulation is a model of driver behavior, not a replay of a real road. It reproduces how queues form; it does not reproduce any particular evening.',
    'The personal cost calculator models a salaried commuter with a fixed workplace and a five-day week. It does not represent the readers who bear the largest share of this congestion: people who walk because a fare is unaffordable, or who spend hours standing in buses on wages the calculator has no way to price. That omission is a limit of the model, not a finding about who is affected.',
  ];
}

/** A native disclosure: accessible, keyboard-operable, works unscripted. */
function disclosure(summaryText: string, body: HTMLElement): HTMLDetailsElement {
  const d = document.createElement('details');
  d.className = 'method-disclosure';
  const s = document.createElement('summary');
  s.textContent = summaryText;
  d.append(s, body);
  return d;
}

export function drawMethodology(): void {
  const host = document.getElementById('methodTable');
  if (!host) return;
  host.textContent = '';

  const counts = { measured: 0, derived: 0, modeled: 0 };
  for (const d of DATASETS) counts[d.provenance]++;

  const summary = document.getElementById('methodSummary');
  if (summary) {
    summary.textContent =
      `${SPELLED[DATASETS.length] ?? DATASETS.length} datasets drive this page: ${counts.measured} measured `
      + `and published by others, ${counts.derived} derived here from those inputs, and ${counts.modeled} modeled `
      + `— built to be plausible where no public series exists.`;
  }

  /* ---------- the ledger, as a table you can scan ---------- */
  const table = document.createElement('table');
  table.className = 'method-table';

  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  for (const h of ['Status', 'Dataset', 'Where it appears']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = h;
    hrow.append(th);
  }
  thead.append(hrow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const d of DATASETS) {
    const tr = document.createElement('tr');

    const tdTag = document.createElement('td');
    tdTag.append(tag(d.provenance));

    const tdWhat = document.createElement('th');
    tdWhat.scope = 'row';
    tdWhat.textContent = d.what;

    const tdWhere = document.createElement('td');
    tdWhere.className = 'method-where';
    tdWhere.textContent = d.used;

    if (d.source) {
      const src = SOURCES[d.source];
      if (src) {
        const a = document.createElement('a');
        a.className = 'chip chip-src';
        a.href = `#src-${src.id}`;
        a.textContent = src.label;
        tdWhere.append(document.createElement('br'), a);
      }
    }

    tr.append(tdTag, tdWhat, tdWhere);
    tbody.append(tr);
  }
  table.append(tbody);
  host.append(table);

  /* ---------- the reasoning, one click away ---------- */
  const longform = document.createElement('div');
  longform.className = 'method-longform';
  for (const d of DATASETS) {
    const block = document.createElement('div');
    block.className = 'method-block';

    const h = document.createElement('h4');
    h.append(tag(d.provenance), document.createTextNode(d.what));

    const p = document.createElement('p');
    p.textContent = d.method;
    block.append(h, p);

    if (d.toUpgrade) {
      const up = document.createElement('p');
      up.className = 'method-upgrade';
      const b = document.createElement('b');
      b.textContent = 'To measure it: ';
      up.append(b, document.createTextNode(d.toUpgrade));
      block.append(up);
    }
    longform.append(block);
  }
  host.append(disclosure('How each dataset was arrived at', longform));

  const limits = limitations();
  const ul = document.createElement('ul');
  ul.className = 'method-limits';
  for (const t of limits) {
    const li = document.createElement('li');
    li.textContent = t;
    ul.append(li);
  }
  host.append(disclosure(`Limitations (${limits.length})`, ul));
}
