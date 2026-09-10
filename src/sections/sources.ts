/* =====================================================================
   PROVENANCE & DATA EXPLORER
   A citation chip beside every figure and an instant dataset viewer/exporter.
   ===================================================================== */
import {
  CITY_FACTS,
  CONGESTION_RAMP,
  CORRIDORS,
  HOURLY_SPEED_KMH,
  LINKS,
  NODES,
  RACE,
  ROUTES,
  SOLUTIONS,
  SOURCES,
  SPEED_HISTORY,
} from '../data/traffic';
import { copyTextWithFeedback } from '../util';

/**
 * Fill every `[data-source="id"]` with a citation chip linking to the matching
 * entry in the sources list.
 */
export function stampProvenance(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-source]')) {
    const src = SOURCES[el.dataset['source'] ?? ''];
    if (!src) continue;
    el.textContent = '';
    const a = document.createElement('a');
    a.className = 'chip chip-src';
    a.href = `#src-${src.id}`;
    a.textContent = src.label;
    a.setAttribute('aria-label', `Source: ${src.publisher}, ${src.year}. Jump to full citation.`);
    el.append(a);
  }
}

/** The city-wide figures, all sourced, as a grid of cards. */
export function drawFacts(): void {
  const host = document.getElementById('facts');
  if (!host) return;
  host.textContent = '';
  for (const f of CITY_FACTS) {
    const src = SOURCES[f.source];
    const card = document.createElement('div');
    card.className = 'fact';

    const v = document.createElement('b');
    v.textContent = f.value;

    const u = document.createElement('span');
    u.textContent = f.unit;

    card.append(v, u);

    if (src) {
      const a = document.createElement('a');
      a.className = 'chip chip-src';
      a.href = `#src-${src.id}`;
      a.textContent = src.label;
      card.append(a);
    }
    host.append(card);
  }
}

/** The full citation list, rendered from the same records the chips use. */
export function drawSources(): void {
  const host = document.getElementById('sourcesList');
  if (!host) return;
  host.textContent = '';

  for (const src of Object.values(SOURCES)) {
    const li = document.createElement('li');
    li.id = `src-${src.id}`;

    const pub = document.createElement('b');
    pub.textContent = `${src.publisher}, ${src.year}`;

    const title = document.createElement('span');
    title.textContent = src.title;

    li.append(pub, title);

    if (src.via) {
      const via = document.createElement('span');
      via.className = 'src-via';
      via.textContent = `Read via ${src.via}.`;
      li.append(via);
    }
    if (src.note) {
      const note = document.createElement('span');
      note.className = 'src-via';
      note.textContent = src.note;
      li.append(note);
    }

    const a = document.createElement('a');
    a.href = src.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Open source document';
    li.append(a);

    host.append(li);
  }

  setupDataExporter();
}

/**
 * Setup Data Explorer table and 1-click JSON download/copy for researchers
 * at Advanced AI Lab Data Studio.
 */
function setupDataExporter(): void {
  const fullDataset = {
    meta: {
      title: 'Seven Kilometers an Hour: Dhaka Traffic Dataset',
      curator: 'Advanced AI Lab Data Studio',
      generatedAt: '2026-09-02',
      license: 'Open Access Research & Educational Use',
    },
    sourced: {
      speedHistory: SPEED_HISTORY,
      cityFacts: CITY_FACTS,
      raceBenchmarks: RACE,
      sources: SOURCES,
    },
    modelsAndIllustrative: {
      hourlySpeedProfile: HOURLY_SPEED_KMH,
      corridors: CORRIDORS,
      corridorMapNodes: NODES,
      corridorMapLinks: LINKS,
      commuteLossByRoute: ROUTES,
      congestionRamp: CONGESTION_RAMP,
      solutions: SOLUTIONS,
    },
  };

  const copyBtn = document.getElementById('copyRawDataBtn');
  if (copyBtn && copyBtn.dataset['wired'] !== '1') {
    copyBtn.dataset['wired'] = '1';
    copyBtn.addEventListener('click', () => {
      copyTextWithFeedback(JSON.stringify(fullDataset, null, 2), copyBtn);
    });
  }

  const downloadBtn = document.getElementById('downloadRawDataBtn');
  if (downloadBtn && downloadBtn.dataset['wired'] !== '1') {
    downloadBtn.dataset['wired'] = '1';
    downloadBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(fullDataset, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dhaka-traffic-dataset.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  const toggleTableBtn = document.getElementById('toggleDataTableBtn');
  const tableHost = document.getElementById('rawDataTableWrap');
  if (toggleTableBtn && tableHost && toggleTableBtn.dataset['wired'] !== '1') {
    toggleTableBtn.dataset['wired'] = '1';
    toggleTableBtn.addEventListener('click', () => {
      const open = toggleTableBtn.getAttribute('aria-expanded') === 'true';
      toggleTableBtn.setAttribute('aria-expanded', String(!open));
      toggleTableBtn.textContent = open ? 'View the full data table' : 'Hide the data table';
      tableHost.hidden = open;
      if (!open && !tableHost.hasChildNodes()) {
        renderFullSummaryTable(tableHost);
      }
    });
  }
}

function renderFullSummaryTable(host: HTMLElement): void {
  host.innerHTML = `
    <div class="dataset-table-container">
      <table class="datatable">
        <caption>Key Sourced Observations & Benchmarks (Advanced AI Lab Data Studio)</caption>
        <thead>
          <tr>
            <th scope="col">Year / Category</th>
            <th scope="col">Speed / Value</th>
            <th scope="col">Metric Type</th>
            <th scope="col">Primary Source</th>
          </tr>
        </thead>
        <tbody>
          ${SPEED_HISTORY.map((pt) => `
            <tr>
              <td><b>${pt.yearLabel ?? pt.year}</b></td>
              <td>${pt.kmh} km/h</td>
              <td>${pt.metric}</td>
              <td>${SOURCES[pt.source]?.label ?? pt.source}</td>
            </tr>
          `).join('')}
          <tr>
            <td><b>Normal Walking Speed</b></td>
            <td>${RACE.walkKmh} km/h</td>
            <td>Pedestrian baseline</td>
            <td>${SOURCES[RACE.walkSource]?.label ?? 'Bohannon & Williams, 2011'}</td>
          </tr>
          <tr>
            <td><b>Metro Rail (MRT Line 6)</b></td>
            <td>${RACE.metroKmh} km/h</td>
            <td>Elevated transit commercial avg</td>
            <td>${SOURCES[RACE.metroSource]?.label ?? 'DMTCL, 2023'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

/* =====================================================================
   COLOPHON — who supplied the numbers, and what the page is built from

   The source list is derived from SOURCES rather than typed out, so adding a
   citation adds it here too and the two can never disagree. The stack list is
   deliberately literal: only what this project actually uses.
   ===================================================================== */
const BUILT_WITH: readonly string[] = [
  'Vite · TypeScript',
  'D3 (scale, shape, selection)',
  'Three.js · WebGL',
  'Fraunces & Karla, self-hosted',
  'Google Routes API collector',
  'OpenAQ collector',
];

function colophonList(host: HTMLElement, heading: string, items: readonly string[]): void {
  const h = document.createElement('h3');
  h.className = 'colophon-head';
  h.textContent = heading;

  const ul = document.createElement('ul');
  ul.className = 'colophon-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    ul.append(li);
  }
  host.append(h, ul);
}

export function drawColophon(): void {
  const sourcesHost = document.getElementById('colophonSources');
  const builtHost = document.getElementById('colophonBuilt');

  if (sourcesHost) {
    sourcesHost.textContent = '';
    // one entry per organization, in the order they first appear
    const orgs: string[] = [];
    for (const src of Object.values(SOURCES)) {
      if (!orgs.includes(src.org)) orgs.push(src.org);
    }
    colophonList(sourcesHost, 'Data sources', orgs);
  }

  if (builtHost) {
    builtHost.textContent = '';
    colophonList(builtHost, 'Built with', BUILT_WITH);
  }
}
