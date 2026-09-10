import { scaleLinear } from 'd3-scale';
import { interpolateRgb } from 'd3-interpolate';
import { CONGESTION_RAMP } from './data/traffic';

/** Two ink colors that appear inside SVG, where CSS custom properties cannot. */
export const CREAM = '#F8F3EA';
export const INK = '#20130E';
export const TEAL = '#0D6A6C';
/**
 * The Metro line color. Not on the congestion ramp — the metro is a different
 * mode, not a faster road — so it sits at hue 301, clear of the ramp's 27-170,
 * and dark enough to read on the cream map (15.7:1, against 1.4:1 for the neon
 * cyan it replaces). Deep saturated line colors are what transit maps use.
 */
export const METRO = '#161440';

/*
 * Reduced motion, read live rather than once at boot.
 *
 * Two reasons it is not a plain `const matchMedia(...).matches`:
 *
 *   - Somebody who turns the preference on mid-visit should get the quiet
 *     version of the page without reloading. The listener below makes REDUCED a
 *     live binding, which ES modules propagate to every importer.
 *   - `matchMedia` does not exist outside a browser, and this module is
 *     imported by code that runs under the test runner. Guarding it is what
 *     lets the congestion scale be tested at all.
 */
const motionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

export let REDUCED = motionQuery ? motionQuery.matches : false;

const motionListeners = new Set<(reduced: boolean) => void>();

if (motionQuery) {
  motionQuery.addEventListener('change', (event) => {
    REDUCED = event.matches;
    for (const listener of motionListeners) listener(REDUCED);
  });
}

/** Subscribe to preference changes. Returns an unsubscribe function. */
export function onReducedMotionChange(fn: (reduced: boolean) => void): () => void {
  motionListeners.add(fn);
  return () => {
    motionListeners.delete(fn);
  };
}

/**
 * The one congestion scale. Every chart and the 3D scene color speed through
 * this, so a road at 6 km/h is the same orange everywhere on the page.
 */
export const speedColor = scaleLinear<string, string>()
  .domain(CONGESTION_RAMP.map((s) => s.kmh))
  .range(CONGESTION_RAMP.map((s) => s.color))
  .interpolate(interpolateRgb)
  .clamp(true);

/** Backward compatibility alias */
export const speedColour = speedColor;

/** Run a function once, the first time its element comes into view. */
export function onView(el: Element | null, fn: () => void): void {
  if (!el) return;
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) {
          fn();
          io.disconnect();
        }
      }),
    { rootMargin: '-12% 0px -12% 0px' },
  );
  io.observe(el);
}

/**
 * Start something while its element is on screen and stop it when it leaves.
 * Both canvases hang their animation loop off this — an off-screen loop is
 * wasted battery.
 */
export function whileVisible(
  el: Element,
  handlers: { start: () => void; stop: () => void },
  options: IntersectionObserverInit = { threshold: 0 },
): IntersectionObserver {
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => (e.isIntersecting ? handlers.start() : handlers.stop())),
    options,
  );
  io.observe(el);
  return io;
}

/** 0 → "12:00 AM", 13 → "1:00 PM". */
export function clockLabel(hour: number): string {
  const h = hour | 0;
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

/** 0 → "12 AM", 13 → "1 PM". The short form the clock uses. */
export function shortHourLabel(hour: number): string {
  const h = hour | 0;
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}
/** Copies text to clipboard with graceful textarea fallback and visual button feedback. */
export function copyTextWithFeedback(
  text: string,
  btn: HTMLElement,
  successLabel = 'Copied',
  errorLabel = 'Failed to copy',
): void {
  const original = btn.textContent;
  const show = (label: string): void => {
    btn.textContent = label;
    setTimeout(() => {
      btn.textContent = original;
    }, 2200);
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text)
      .then(() => show(successLabel))
      .catch(() => fallbackCopy(text, show, successLabel, errorLabel));
  } else {
    fallbackCopy(text, show, successLabel, errorLabel);
  }
}

function fallbackCopy(
  text: string,
  show: (label: string) => void,
  successLabel: string,
  errorLabel: string,
): void {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.focus();
    area.select();
    const success = document.execCommand('copy');
    document.body.removeChild(area);
    show(success ? successLabel : errorLabel);
  } catch {
    show(errorLabel);
  }
}
