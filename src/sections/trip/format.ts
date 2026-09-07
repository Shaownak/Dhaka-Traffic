/* =====================================================================
   FORMATTING — how numbers and labels reach the screen

   Shared by every panel in the planner, so it lives here rather than being
   redefined per view. Pure functions over primitives; nothing here reads state.
   ===================================================================== */

/* ---------- formatting ---------- */

export function fmt(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function clock(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

export function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12AM';
  if (h < 12) return `${h}AM`;
  if (h === 12) return '12PM';
  return `${h - 12}PM`;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const LEVEL_LABEL: Record<string, string> = {
  FREE: 'Clear', LIGHT: 'Light', MODERATE: 'Moderate', HEAVY: 'Heavy', SEVERE: 'Severe',
};

export const LABEL_TEXT: Record<string, string> = {
  RECOMMENDED: 'Recommended',
  FASTEST: 'Fastest',
  MOST_RELIABLE: 'Most reliable',
  SHORTEST: 'Shortest',
  LEAST_TRAFFIC: 'Least traffic',
  BEST_WITH_STOP: 'Best with a stop',
};
