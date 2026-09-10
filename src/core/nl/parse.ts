/* =====================================================================
   NATURAL LANGUAGE — turning a sentence into constraints, and nothing more

   "I want to leave Gulshan at 5 PM, eat somewhere halfway, and reach Mirpur
   before 7" becomes an intent with two place names, two times and a stop
   request. It does NOT become a route, a duration or a coordinate: those are
   computed afterwards, from data, by code that has never seen the sentence.

   This parser is rules, not a model. That is a deliberate choice rather than
   a placeholder:

     - it runs offline, in a millisecond, with no key and no per-request cost
     - it is deterministic, so the same sentence always plans the same journey
     - it cannot hallucinate a place that is not in the network, because it
       can only ever return spans that matched the known place index

   A model would read messier sentences than this does, and there is a seam for
   one: `parseWithLlm` takes any function returning a raw object, pushes it
   through the same validator, and falls back to these rules when it fails.
   Even then the model's output is constrained to the intent schema — it never
   reaches the engine directly.
   ===================================================================== */
import type { PreferenceId } from '../../data/intelligence';
import { findPlaceMentions, normalizeQuery } from '../geocoding/resolve';
import { validateIntent, type JourneyIntent, type IntentPlaceKind } from './schema';

export interface ParseResult {
  ok: boolean;
  /** Present when ok. Ready to hand to the planner. */
  request: (JourneyIntent & { date: string }) | null;
  /** What was understood, for showing back to the reader. */
  understood: string[];
  /** What could not be read. */
  problems: string[];
}

/* ---------- time ---------- */

/**
 * Times as people write them: "5 pm", "5:30pm", "17:00", "5 o'clock".
 * Bare numbers are read as clock times only next to a time word, so
 * "Mirpur 10" is not mistaken for ten o'clock.
 */
const TIME_PATTERN = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)?\b/g;

interface TimeHit {
  minutes: number;
  at: number;
  /** The word before it, which says whether it is a departure or a deadline. */
  cue: 'depart' | 'arrive' | null;
  explicit: boolean;
}

const DEPART_CUES = /\b(leave|leaving|depart|departing|start|starting|set off|at)\s*$/;
const ARRIVE_CUES = /\b(by|before|reach|arrive|arriving|get there|no later than|be there)\s*$/;

function findTimes(text: string): TimeHit[] {
  const hits: TimeHit[] = [];
  const lower = text.toLowerCase();

  for (const match of lower.matchAll(TIME_PATTERN)) {
    const at = match.index ?? 0;
    let hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    const meridiem = match[3]?.replace(/\s/g, '');

    if (!Number.isFinite(hour) || hour > 24 || minute > 59) continue;

    const before = lower.slice(Math.max(0, at - 24), at);
    const cue: TimeHit['cue'] =
      ARRIVE_CUES.test(before) ? 'arrive' : DEPART_CUES.test(before) ? 'depart' : null;

    // A bare number with no meridiem, no colon and no time cue is not a time.
    const explicit = Boolean(meridiem) || Boolean(match[2]);
    if (!explicit && cue === null) continue;

    if (meridiem && (hour < 1 || hour > 12)) continue;
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    // No meridiem: assume the waking hours somebody would actually travel in.
    if (!meridiem && !match[2] && hour >= 1 && hour <= 7) hour += 12;

    if (hour > 23) continue;
    hits.push({ minutes: hour * 60 + minute, at, cue, explicit });
  }
  return hits;
}

/* ---------- date ---------- */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function findDate(text: string, now: Date): { date: Date; said: string | null } {
  const lower = text.toLowerCase();
  const base = new Date(now);
  base.setHours(12, 0, 0, 0);

  if (/\bday after tomorrow\b/.test(lower)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 2);
    return { date: d, said: 'the day after tomorrow' };
  }
  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return { date: d, said: 'tomorrow' };
  }
  if (/\btonight\b|\btoday\b|\bthis evening\b|\bthis afternoon\b/.test(lower)) {
    return { date: base, said: 'today' };
  }

  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (!new RegExp(`\\b(next\\s+)?${WEEKDAYS[i]}\\b`).test(lower)) continue;
    const d = new Date(base);
    // the next occurrence of that weekday, today not counting
    const delta = ((i - d.getDay() + 7) % 7) || 7;
    d.setDate(d.getDate() + delta);
    return { date: d, said: WEEKDAYS[i]! };
  }

  return { date: base, said: null };
}

/* ---------- stop ---------- */

const KIND_WORDS: { pattern: RegExp; kinds: IntentPlaceKind[]; said: string }[] = [
  { pattern: /\b(coffee|cafe|café|tea|espresso)\b/, kinds: ['cafe'], said: 'a cafe' },
  { pattern: /\b(fast food|burger|takeaway|quick bite|snack)\b/, kinds: ['fast_food'], said: 'somewhere quick' },
  {
    pattern: /\b(restaurant|dinner|lunch|breakfast|eat|meal|food|dine|dining|supper)\b/,
    kinds: ['restaurant', 'cafe', 'fast_food'],
    said: 'somewhere to eat',
  },
];

const POSITION_WORDS: { pattern: RegExp; position: number; said: string }[] = [
  { pattern: /\b(halfway|half way|midway|middle|mid ?point|half of the way)\b/, position: 0.5, said: 'halfway' },
  { pattern: /\b(a third of the way|third of the way|early on|near the start|beginning)\b/, position: 0.33, said: 'about a third of the way' },
  { pattern: /\b(two thirds|near the end|towards the end|toward the end|close to (?:the )?end)\b/, position: 0.7, said: 'near the end' },
  { pattern: /\b(on the way|en route|along the way|somewhere on route)\b/, position: 0.5, said: 'on the way' },
];

/** Cuisines OSM actually tags in Dhaka, so a match can be honoured. */
const CUISINES = [
  'bengali', 'bangladeshi', 'indian', 'chinese', 'thai', 'italian', 'pizza',
  'burger', 'kebab', 'biryani', 'japanese', 'sushi', 'korean', 'mexican',
  'american', 'arab', 'turkish', 'seafood', 'barbecue', 'coffee_shop',
];

const DWELL_PATTERN = /\b(?:for|spend(?:ing)?)\s+(?:about\s+|around\s+)?(?:(an|a)\s+)?(\d{1,3})?\s*(hour|hours|hr|hrs|minute|minutes|min|mins)\b/;

function findDwell(text: string): { minutes: number; said: string } | null {
  const match = DWELL_PATTERN.exec(text.toLowerCase());
  if (!match) return null;
  const count = match[2] ? Number(match[2]) : match[1] ? 1 : NaN;
  if (!Number.isFinite(count)) return null;
  const unit = match[3]!;
  const minutes = /^h/.test(unit) ? count * 60 : count;
  if (minutes <= 0 || minutes > 480) return null;
  return { minutes: Math.round(minutes), said: `${minutes} minutes there` };
}

/* ---------- preference ---------- */

const PREFERENCE_WORDS: { pattern: RegExp; id: PreferenceId; said: string }[] = [
  { pattern: /\b(fastest|quickest|as fast as possible|as quickly as possible|asap|soonest)\b/, id: 'FASTEST', said: 'the fastest route' },
  { pattern: /\b(shortest|least distance|fewest kilometres|fewest kilometers)\b/, id: 'SHORTEST', said: 'the shortest route' },
  { pattern: /\b(reliable|predictable|dependable|on time|safest bet)\b/, id: 'MOST_RELIABLE', said: 'the most reliable route' },
  { pattern: /\b(avoid traffic|least traffic|avoid jams|less congestion|quieter roads)\b/, id: 'LOW_TRAFFIC', said: 'the least congested route' },
];

/* ---------- the parser ---------- */

function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Read a sentence into a journey intent.
 *
 * `now` is passed in rather than read from the clock so the same sentence is
 * reproducible in a test.
 */
export function parseJourneyText(text: string, now: Date = new Date()): ParseResult {
  const understood: string[] = [];
  const problems: string[] = [];
  const raw = (text ?? '').trim();

  if (!raw) {
    return { ok: false, request: null, understood, problems: ['Nothing to read.'] };
  }

  /* --- places --- */
  const mentions = findPlaceMentions(raw);
  if (mentions.length < 2) {
    problems.push(
      mentions.length === 0
        ? 'No place on the Dhaka network was recognised in that.'
        : `Only ${mentions[0]!.place.name} was recognised; a journey needs two places.`,
    );
    return { ok: false, request: null, understood, problems };
  }

  // Decide which end is which from the words in front of each mention.
  const normalized = normalizeQuery(raw);
  let origin = mentions[0]!;
  let destination = mentions[mentions.length - 1]!;

  for (const mention of mentions) {
    const before = normalized.slice(Math.max(0, mention.at - 18), mention.at);
    if (/\b(from|leave|leaving|start|starting|depart|departing)\s+$/.test(before)) origin = mention;
    if (/\b(to|reach|reaching|towards|toward|into|arrive at|get to)\s+$/.test(before)) destination = mention;
  }

  if (origin.place.id === destination.place.id) {
    // two mentions of one place, or cues that both landed on the same one
    const other = mentions.find((m) => m.place.id !== origin.place.id);
    if (!other) {
      problems.push(`Only ${origin.place.name} was recognised; a journey needs two different places.`);
      return { ok: false, request: null, understood, problems };
    }
    if (other.at > origin.at) destination = other;
    else origin = other;
  }

  understood.push(`from ${origin.place.name} to ${destination.place.name}`);

  /* --- date --- */
  const { date, said: dateSaid } = findDate(raw, now);
  if (dateSaid) understood.push(dateSaid);

  /* --- times --- */
  const times = findTimes(raw);
  let departAt: number | undefined;
  let arriveBy: number | undefined;

  for (const hit of times) {
    if (hit.cue === 'arrive' && arriveBy === undefined) arriveBy = hit.minutes;
    else if (hit.cue === 'depart' && departAt === undefined) departAt = hit.minutes;
  }
  // An unattributed time is a departure, which is what "at 5" usually means.
  if (departAt === undefined && arriveBy === undefined) {
    const first = times.find((t) => t.explicit);
    if (first) departAt = first.minutes;
  }

  if (departAt !== undefined) understood.push(`leaving around ${clock(departAt)}`);
  if (arriveBy !== undefined) understood.push(`arriving by ${clock(arriveBy)}`);
  if (departAt === undefined && arriveBy === undefined) {
    problems.push('No time was recognised, so 5 PM was assumed.');
    departAt = 17 * 60;
  }

  /* --- preference --- */
  let preference: PreferenceId | undefined;
  const lower = raw.toLowerCase();
  for (const p of PREFERENCE_WORDS) {
    if (p.pattern.test(lower)) {
      preference = p.id;
      understood.push(p.said);
      break;
    }
  }

  /* --- stop --- */
  let stop: JourneyIntent['stop'] = null;
  const stopText = lower.replace(/\b(?:no|without|skip|avoid|don't|do not)\s+(?:a\s+|any\s+|stopping\s+(?:for|at)\s+|stop\s+(?:for|at)\s+)?(?:restaurant|food|meal|coffee|cafe|tea|dinner|lunch|breakfast|eat|eating)(?:\s+stop)?\b/g, '');
  for (const kind of KIND_WORDS) {
    if (!kind.pattern.test(stopText)) continue;

    let position = 0.5;
    let positionSaid = 'halfway';
    for (const p of POSITION_WORDS) {
      if (p.pattern.test(lower)) {
        position = p.position;
        positionSaid = p.said;
        break;
      }
    }

    const dwell = findDwell(raw);
    stop = {
      kinds: kind.kinds,
      position,
      dwellMinutes: dwell?.minutes ?? 45,
    };

    const cuisine = CUISINES.find((c) => new RegExp(`\\b${c.replace('_', ' ')}\\b`).test(lower));
    if (cuisine) stop.cuisine = cuisine;

    understood.push(`${kind.said} ${positionSaid}${cuisine ? ` (${cuisine})` : ''}`);
    if (dwell) understood.push(dwell.said);
    break;
  }

  /* --- through the same gate a model's output would face --- */
  const candidate: Record<string, unknown> = {
    origin: origin.place.id,
    destination: destination.place.id,
    date: isoDate(date),
  };
  if (departAt !== undefined) candidate.departAt = departAt;
  if (arriveBy !== undefined) candidate.arriveBy = arriveBy;
  if (preference !== undefined) candidate.preference = preference;
  if (stop) candidate.stop = stop;

  const validation = validateIntent(candidate);
  if (!validation.ok || !validation.intent) {
    return { ok: false, request: null, understood, problems: [...problems, ...validation.problems] };
  }

  return { ok: true, request: validation.intent, understood, problems };
}

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/* =====================================================================
   THE SEAM FOR A LANGUAGE MODEL

   Nothing calls this yet, and nothing has to. It exists so that adding a model
   later is a wiring change rather than an architectural one — and so the shape
   of that change is fixed now, while the constraint is fresh: the model's
   output goes through `validateIntent` exactly like the rule parser's, and a
   failure falls back to rules rather than to the model's best guess.
   ===================================================================== */

export type IntentExtractor = (text: string, todayIso: string) => Promise<unknown>;

/**
 * Use a model to read the sentence, with the rules as a safety net.
 *
 * The model never sees the network, never proposes a route and never returns a
 * number about the world. It converts words into the intent schema; if it
 * returns anything else, that output is discarded.
 */
export async function parseWithLlm(
  text: string,
  extract: IntentExtractor,
  now: Date = new Date(),
): Promise<ParseResult> {
  const fallback = parseJourneyText(text, now);
  try {
    const raw = await extract(text, isoDate(now));
    const validation = validateIntent(raw);
    if (validation.ok && validation.intent) {
      return { ok: true, request: validation.intent, understood: ['read by language model'], problems: [] };
    }
    return {
      ...fallback,
      problems: [
        ...fallback.problems,
        ...validation.problems.map((p) => `the model's reading was rejected: ${p}`),
      ],
    };
  } catch {
    return { ...fallback, problems: [...fallback.problems, 'the language model was unavailable'] };
  }
}
