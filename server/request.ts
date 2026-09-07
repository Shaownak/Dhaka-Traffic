/* =====================================================================
   REQUEST SHAPING — the API's only translation layer

   Separated from api.ts so it can be tested without starting a server.

   Its one job is to turn an HTTP body into a JourneyRequest, and its one rule
   is that it must not launder the input. An earlier version copied the fields
   it recognised into a fresh object and validated that; unknown keys never
   reached the validator, so a caller sending `"trafficConditions": "heavy"`
   received a plan as though the field had been honoured. A strict schema is
   worthless if the layer above it quietly drops what the schema would have
   rejected.
   ===================================================================== */
import { parseJourneyText } from '../src/core/nl/parse';
import { validateIntent } from '../src/core/nl/schema';
import type { JourneyRequest } from '../src/core/journey/types';

export interface RawJourneyBody {
  origin?: unknown;
  destination?: unknown;
  date?: unknown;
  departAt?: unknown;
  arriveBy?: unknown;
  preference?: unknown;
  stop?: unknown;
  /** Transport-level, not part of the intent. */
  alternatives?: unknown;
  /** A sentence to read instead of structured fields. */
  text?: unknown;
}

export type ShapeResult =
  | { request: JourneyRequest }
  | { problems: string[] };

export function isoToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Midday, so a timezone offset cannot roll the date into another day. */
export function dateFrom(value: unknown, now: Date = new Date()): Date {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return now;
}

export function toJourneyRequest(body: RawJourneyBody, now: Date = new Date()): ShapeResult {
  // A body may name places directly, or hand over a sentence to be read first.
  if (typeof body.text === 'string' && body.text.trim()) {
    const parsed = parseJourneyText(body.text, now);
    if (!parsed.ok || !parsed.request) return { problems: parsed.problems };
    return { request: fromIntent(parsed.request, now) };
  }

  // The body goes through WHOLE, minus the fields that belong to the transport
  // rather than to the intent. See the header for why this matters.
  const { alternatives, text: _text, ...rest } = body;
  const candidate: Record<string, unknown> = { ...rest };
  if (candidate.date === undefined) candidate.date = isoToday(now);

  const validation = validateIntent(candidate);
  if (!validation.ok || !validation.intent) return { problems: validation.problems };

  const request = fromIntent(validation.intent, now);
  if (typeof alternatives === 'number' && Number.isFinite(alternatives)) {
    request.alternatives = Math.max(1, Math.min(8, Math.round(alternatives)));
  }
  return { request };
}

type Intent = ReturnType<typeof validateIntent>['intent'];

function fromIntent(intent: NonNullable<Intent>, now: Date): JourneyRequest {
  const request: JourneyRequest = {
    origin: intent.origin,
    destination: intent.destination,
    date: dateFrom(intent.date, now),
  };
  if (intent.departAt !== undefined) request.departAt = intent.departAt;
  if (intent.arriveBy !== undefined) request.arriveBy = intent.arriveBy;
  if (intent.preference !== undefined) request.preference = intent.preference;
  if (intent.stop) request.stop = intent.stop;
  return request;
}
