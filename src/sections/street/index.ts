/* =====================================================================
   5. NOW STAND IN IT — section wiring
   Owns the controls and the HUD. Three is pulled in only when the section
   comes near the viewport, and only if the browser can actually draw it.
   ===================================================================== */
import { REDUCED, clockLabel, whileVisible } from '../../util';
import { CORRIDORS } from '../../data/traffic';
import { TrafficModel, corridorConditions } from './traffic-model';
import type { CameraPreset, StreetScene } from './scene';

let scene: StreetScene | null = null;
let hour = 18;
let corridor = 0;
let isRain = false;
let loading = false;

function hud(): void {
  const time = document.getElementById('hudTime');
  const speed = document.getElementById('hudSpeed');
  const { kmh } = corridorConditions(corridor, hour, isRain);
  if (time) time.textContent = clockLabel(hour);
  if (speed) {
    const weather = isRain ? ' (Monsoon Waterlogging)' : '';
    speed.textContent = `${CORRIDORS[corridor]?.name ?? 'Traffic'} moving at ${kmh.toFixed(1)} km/h${weather}`;
  }
}

/** WebGL can be off, or fail on the first context. Either way, say so. */
function fallback(stage: HTMLElement): void {
  stage.style.display = 'none';
  const note = document.getElementById('nowebgl');
  if (note) note.style.display = 'block';
}

async function load(stage: HTMLElement): Promise<void> {
  if (scene || loading) return;
  loading = true;
  try {
    const mod = await import('./scene');
    scene = new mod.StreetScene(stage, new TrafficModel());
    scene.onReadout = (r) => {
      const time = document.getElementById('hudTime');
      const speed = document.getElementById('hudSpeed');
      if (time) time.textContent = clockLabel(r.hour);
      if (speed) {
        const weather = r.isRain ? ' (Monsoon Waterlogging)' : '';
        speed.textContent = `${r.corridor} moving at ${r.kmh.toFixed(1)} km/h${weather}`;
      }
    };
    scene.setHour(hour, true);
    scene.setCorridor(corridor);
    scene.setRain(isRain);
    scene.resize();
    scene.start();

    // Loop stops when off-screen to save battery
    whileVisible(stage, {
      start: () => scene?.start(),
      stop: () => scene?.stop(),
    });
  } catch {
    fallback(stage);
  } finally {
    loading = false;
  }
}

export function setStreetHour(newHour: number): void {
  hour = newHour;
  const slider = document.getElementById('hourSlider') as HTMLInputElement | null;
  if (slider) slider.value = String(newHour);
  if (scene) scene.setHour(newHour);
  else hud();
}

export function setStreetCorridor(newCorridor: number): void {
  corridor = newCorridor;
  const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chips button'));
  for (const b of chips) {
    b.setAttribute('aria-pressed', String(Number(b.dataset['r']) === newCorridor));
  }
  if (scene) scene.setCorridor(newCorridor);
  else hud();
}

export function initStreet(): void {
  const stage = document.getElementById('stage');
  if (!stage) return;

  const slider = document.getElementById('hourSlider') as HTMLInputElement | null;
  if (slider) {
    hour = Number(slider.value);
    slider.addEventListener('input', () => {
      hour = Number(slider.value);
      if (scene) scene.setHour(hour);
      else hud();
    });
  }

  const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chips button'));
  for (const b of chips) {
    b.addEventListener('click', () => {
      corridor = Number(b.dataset['r'] ?? 0);
      for (const o of chips) o.setAttribute('aria-pressed', String(o === b));
      if (scene) scene.setCorridor(corridor);
      else hud();
    });
  }

  // Camera preset buttons
  const camBtns = Array.from(document.querySelectorAll<HTMLButtonElement>('.cam-presets button'));
  for (const b of camBtns) {
    b.addEventListener('click', () => {
      const preset = (b.dataset['cam'] ?? 'orbit') as CameraPreset;
      for (const o of camBtns) o.setAttribute('aria-pressed', String(o === b));
      if (scene) scene.setCameraPreset(preset);
    });
  }

  // Monsoon rain toggle button
  const rainBtn = document.getElementById('rainToggle') as HTMLButtonElement | null;
  if (rainBtn) {
    rainBtn.addEventListener('click', () => {
      isRain = !isRain;
      rainBtn.setAttribute('aria-pressed', String(isRain));
      rainBtn.classList.toggle('active', isRain);
      if (scene) scene.setRain(isRain);
      else hud();
    });
  }

  hud();

  // Start fetching Three a screen early so the section is ready
  const loader = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      loader.disconnect();
      void load(stage);
    },
    { rootMargin: REDUCED ? '0px' : '400px 0px' },
  );
  loader.observe(stage);
}

export function resizeStreet(): void {
  scene?.resize();
}
