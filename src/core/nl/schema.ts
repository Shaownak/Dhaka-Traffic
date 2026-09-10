/* =====================================================================
   INTENT SCHEMA — the gate every parser has to pass through

   This exists because of one rule: a language model may read a sentence, and
   it may never reach the routing engine. Whatever produces a structured
   intent — the rule-based parser in this directory, or some model added
   later — its output arrives here as `unknown` and leaves as either a
   validated intent or a list of complaints.

   The validator is strict on purpose. It rejects unknown fields rather than
   ignoring them, because a model inventing `"trafficConditions": "heavy"` must
   fail loudly rather than have it silently dropped, leaving everyone to
   believe the field was honoured.

   No coordinates, no durations, no distances, no traffic. An intent may name
   a PLACE, never a position; may state a TIME the traveller chose, never a
   travel time. Everything numeric about the world is computed downstream from
   real data.
   ===================================================================== */
import { PREFERENCES, type PreferenceId } from '../../data/intelligence';

export const PLACE_KINDS = ['restaurant', 'cafe', 'fast_food'] as const;
export type IntentPlaceKind = (typeof PLACE_KINDS)[number];

export interface StopIntent {
  kinds: IntentPlaceKind[];
  /** 0 at the origin, 1 at the destination. */
  position: number;
  dwellMinutes: number;
  cuisine?: string;
  requireOpen?: boolean;
}

/**
 * What a sentence is allowed to mean.
 *
 * Origin and destination are the words the traveller used; resolving them to
 * junctions is the geocoder's job, not the parser's, and certainly not a
 * model's.
 */
export interface JourneyIntent {
  origin: string;
  destination: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Minutes after midnight. */
  departAt?: number;
  arriveBy?: number;
  preference?: PreferenceId;
  stop?: StopIntent | null;
}

export interface ValidationResult {
  ok: boolean;
  intent: JourneyIntent | null;
  /** One entry per rule broken, naming the field. */
  problems: string[];
}

const ALLOWED_TOP = new Set([
  'origin', 'destination', 'date', 'departAt', 'arriveBy', 'preference', 'stop',
]);
const ALLOWED_STOP = new Set([
  'kinds', 'position', 'dwellMinutes', 'cuisine', 'requireOpen',
]);

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTES_IN_DAY = 24 * 60;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkMinutes(value: unknown, field: string, problems: string[]): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push(`${field} must be a number of minutes after midnight.`);
    return undefined;
  }
  if (value < 0 || Math.round(value) >= MINUTES_IN_DAY) {
    problems.push(`${field} must be between 0 and ${MINUTES_IN_DAY - 1}.`);
    return undefined;
  }
  return Math.round(value);
}

function validateStop(raw: unknown, problems: string[]): StopIntent | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (!isObject(raw)) {
    problems.push('stop must be an object or null.');
    return undefined;
  }

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_STOP.has(key)) problems.push(`stop.${key} is not a field this system accepts.`);
  }

  const kinds: IntentPlaceKind[] = [];
  if (!Array.isArray(raw.kinds) || raw.kinds.length === 0) {
    problems.push('stop.kinds must be a non-empty array.');
  } else {
    for (const kind of raw.kinds) {
      if (typeof kind !== 'string' || !PLACE_KINDS.includes(kind as IntentPlaceKind)) {
        problems.push(`stop.kinds contains "${String(kind)}", which is not one of ${PLACE_KINDS.join(', ')}.`);
      } else if (!kinds.includes(kind as IntentPlaceKind)) {
        kinds.push(kind as IntentPlaceKind);
      }
    }
  }

  let position = 0.5;
  if (raw.position !== undefined) {
    if (typeof raw.position !== 'number' || !Number.isFinite(raw.position)) {
      problems.push('stop.position must be a number between 0 and 1.');
    } else if (raw.position < 0 || raw.position > 1) {
      problems.push('stop.position must be between 0 and 1.');
    } else {
      position = raw.position;
    }
  }

  let dwellMinutes = 45;
  if (raw.dwellMinutes !== undefined) {
    if (typeof raw.dwellMinutes !== 'number' || !Number.isFinite(raw.dwellMinutes)) {
      problems.push('stop.dwellMinutes must be a number.');
    } else if (raw.dwellMinutes < 0 || raw.dwellMinutes > 8 * 60) {
      problems.push('stop.dwellMinutes must be between 0 and 480.');
    } else {
      dwellMinutes = Math.round(raw.dwellMinutes);
    }
  }

  const stop: StopIntent = { kinds, position, dwellMinutes };

  if (raw.cuisine !== undefined) {
    if (typeof raw.cuisine !== 'string') problems.push('stop.cuisine must be a string.');
    else if (raw.cuisine.trim()) stop.cuisine = raw.cuisine.trim().slice(0, 40);
  }
  if (raw.requireOpen !== undefined) {
    if (typeof raw.requireOpen !== 'boolean') problems.push('stop.requireOpen must be true or false.');
    else stop.requireOpen = raw.requireOpen;
  }

  return stop;
}

/**
 * Validate anything claiming to be a journey intent.
 *
 * Returns `ok: false` with every problem listed rather than throwing on the
 * first, so a caller repairing a model's output can see all of it at once.
 */
export function validateIntent(raw: unknown): ValidationResult {
  const problems: string[] = [];

  if (!isObject(raw)) {
    return { ok: false, intent: null, problems: ['The intent must be an object.'] };
  }

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_TOP.has(key)) problems.push(`"${key}" is not a field this system accepts.`);
  }

  const origin = typeof raw.origin === 'string' ? raw.origin.trim() : '';
  const destination = typeof raw.destination === 'string' ? raw.destination.trim() : '';
  if (!origin) problems.push('origin is required and must be a non-empty string.');
  if (!destination) problems.push('destination is required and must be a non-empty string.');

  let date = '';
  if (typeof raw.date !== 'string' || !ISO_DATE.test(raw.date)) {
    problems.push('date is required and must look like YYYY-MM-DD.');
  } else if (!isCalendarDate(raw.date)) {
    problems.push(`date "${raw.date}" is not a real date.`);
  } else {
    date = raw.date;
  }

  const departAt = checkMinutes(raw.departAt, 'departAt', problems);
  const arriveBy = checkMinutes(raw.arriveBy, 'arriveBy', problems);

  let preference: PreferenceId | undefined;
  if (raw.preference !== undefined) {
    const known = PREFERENCES.some((p) => p.id === raw.preference);
    if (!known) problems.push(`preference "${String(raw.preference)}" is not one this system offers.`);
    else preference = raw.preference as PreferenceId;
  }

  const stop = validateStop(raw.stop, problems);

  if (problems.length) return { ok: false, intent: null, problems };

  const intent: JourneyIntent = { origin, destination, date };
  if (departAt !== undefined) intent.departAt = departAt;
  if (arriveBy !== undefined) intent.arriveBy = arriveBy;
  if (preference !== undefined) intent.preference = preference;
  if (stop !== undefined) intent.stop = stop;

  return { ok: true, intent, problems: [] };
}
