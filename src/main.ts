/* =====================================================================
   SEVEN KILOMETERS AN HOUR
   Entry point: section observers and boot order. Styles are linked from the
   document head, not imported here, so they cannot arrive after first paint.
   ===================================================================== */

import { Jam } from './sections/jam';
import { drawRace, resetRace, startRace } from './sections/race';
import { drawHistory, drawSupplyDemand } from './sections/history';
import { drawClock, onHourSelect } from './sections/clock';
import { drawMap, onCorridorSelect } from './sections/map';
import { initCost, revealYear, selectCostRoute } from './sections/cost';
import { drawSolutions } from './sections/solutions';
import { drawNight } from './sections/night';
import { initStreet, resizeStreet, setStreetCorridor, setStreetHour } from './sections/street';
import { drawColophon, drawFacts, drawSources, stampProvenance } from './sections/sources';
import { drawMethodology } from './sections/methodology';
import { initTrip } from './sections/trip';
import { onView, whileVisible } from './util';
import { CORRIDORS } from './data/traffic';

let jam: Jam | null = null;

function boot(): void {
  const lanes = document.getElementById('lanes');
  if (lanes instanceof HTMLCanvasElement) {
    jam = new Jam(lanes);
    whileVisible(lanes, { start: () => jam?.start(), stop: () => jam?.stop() });
  }

  // Citations first
  stampProvenance();
  drawSources();
  drawFacts();
  drawMethodology();
  drawColophon();

  // The race is drawn on load but held at the start line. The metro finishes
  // in about a seventh of the car's time, so a reader arriving mid-cycle would
  // only ever see it parked. It runs while the section is on screen and resets
  // when it leaves, so it always starts from zero for whoever is watching.
  drawRace();
  const raceSection = document.querySelector('.race');
  if (raceSection) {
    whileVisible(raceSection, { start: startRace, stop: resetRace }, { threshold: 0.35 });
  }

  // Section scroll-in triggers
  onView(document.querySelector('.record'), () => { drawHistory(); drawSupplyDemand(); });
  onView(document.querySelector('.clock'), drawClock);
  onView(document.querySelector('.map'), drawMap);
  onView(document.querySelector('.solutions'), drawSolutions);
  onView(document.querySelector('.night'), drawNight);
  initCost();
  onView(document.querySelector('.cost'), revealYear);
  initStreet();
  onView(document.querySelector('.trip'), initTrip);

  // Cross-section interactivity bus
  onHourSelect((h) => {
    setStreetHour(h);
  });

  onCorridorSelect((routeName) => {
    selectCostRoute(routeName);
    // Find matching corridor in 3D scene if present
    const cIdx = CORRIDORS.findIndex((c) =>
      routeName.toLowerCase().includes(c.name.toLowerCase()) ||
      c.name.toLowerCase().includes(routeName.toLowerCase()),
    );
    if (cIdx !== -1) {
      setStreetCorridor(cIdx);
    }
  });
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    jam?.resize();
    drawRace();
    resizeStreet();
  }, 200);
});

// Wait for fonts to avoid layout shift
if (document.fonts) void document.fonts.ready.then(boot);
else boot();
