/* =====================================================================
   OPENING HOURS — a deliberately conservative reader of the OSM syntax

   The full opening_hours grammar is large: public holidays, school terms,
   sunset offsets, week numbers, month ranges. This parser handles the forms
   that actually appear on Dhaka eating places and REFUSES EVERYTHING ELSE.

   Refusing means returning 'unknown', and unknown is never rendered as "open"
   or as "closed". That asymmetry is deliberate. Telling somebody a restaurant
   is open when the syntax was too complex to read is worse than admitting the
   data does not say — they can plan around uncertainty, but not around a
   confident wrong answer.

   About one place in six in the collected dataset states hours at all, so
   'unknown' is the common case and the interface has to treat it as normal
   rather than as a defect.
   ===================================================================== */

export type OpenState = 'open' | 'closed' | 'unknown';

/** OSM day tokens, Monday first, matching the syntax rather than JS. */
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

/** JS getDay() is Sunday-first; the OSM index is Monday-first. */
function osmDayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

interface Rule {
  days: Set<number>;
  /** Minutes after midnight. `to` may exceed 1440 for an overnight range. */
  spans: { from: number; to: number }[];
  /** An explicit closure, as in "Su off". */
  closed: boolean;
}

function parseDays(token: string): Set<number> | null {
  const days = new Set<number>();
  for (const part of token.split(',')) {
    const range = part.trim();
    if (!range) continue;

    const dash = range.split('-');
    if (dash.length === 1) {
      const index = DAYS.indexOf(dash[0] as (typeof DAYS)[number]);
      if (index < 0) return null;
      days.add(index);
      continue;
    }
    if (dash.length !== 2) return null;

    const start = DAYS.indexOf(dash[0]!.trim() as (typeof DAYS)[number]);
    const end = DAYS.indexOf(dash[1]!.trim() as (typeof DAYS)[number]);
    if (start < 0 || end < 0) return null;
    // ranges wrap, as in "Sa-Mo"
    for (let i = start; ; i = (i + 1) % 7) {
      days.add(i);
      if (i === end) break;
    }
  }
  return days.size ? days : null;
}

const TIME = /^([0-9]{1,2}):([0-9]{2})$/;

function parseTime(token: string): number | null {
  const match = TIME.exec(token.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h > 48 || m > 59) return null;
  return h * 60 + m;
}

function parseSpans(token: string): { from: number; to: number }[] | null {
  const spans: { from: number; to: number }[] = [];
  for (const part of token.split(',')) {
    const range = part.trim();
    if (!range) continue;
    const halves = range.split('-');
    if (halves.length !== 2) return null;
    const from = parseTime(halves[0]!);
    let to = parseTime(halves[1]!);
    if (from === null || to === null) return null;
    // "18:00-02:00" runs past midnight; "00:00-24:00" is a whole day
    if (to <= from) to += 24 * 60;
    spans.push({ from, to });
  }
  return spans.length ? spans : null;
}

/**
 * Parse the whole specification, or nothing.
 *
 * A partial parse is not usable: if one rule of three is unreadable, the two
 * that were read cannot establish that a place is closed, because the missing
 * rule may well be the one that opens it.
 */
function parseRules(spec: string): Rule[] | null {
  const rules: Rule[] = [];

  for (const chunk of spec.split(';')) {
    const text = chunk.trim();
    if (!text) continue;

    if (/^24\/7$/i.test(text)) {
      rules.push({ days: new Set([0, 1, 2, 3, 4, 5, 6]), spans: [{ from: 0, to: 1440 }], closed: false });
      continue;
    }

    // "Mo-Fr 09:00-18:00" or "Su off"
    const match = /^([A-Za-z,\-\s]+?)\s+(.+)$/.exec(text);
    if (!match) return null;

    const days = parseDays(match[1]!.replace(/\s+/g, ''));
    if (!days) return null;

    const rest = match[2]!.trim();
    if (/^(off|closed)$/i.test(rest)) {
      rules.push({ days, spans: [], closed: true });
      continue;
    }

    const spans = parseSpans(rest);
    if (!spans) return null;
    rules.push({ days, spans, closed: false });
  }

  return rules.length ? rules : null;
}

/**
 * Is this place open at that moment?
 *
 * Returns 'unknown' whenever the specification is absent or beyond this
 * parser. Callers must not coerce that into either of the other two.
 */
export function isOpenAt(spec: string | undefined, date: Date): OpenState {
  if (!spec || !spec.trim()) return 'unknown';

  const rules = parseRules(spec.trim());
  if (!rules) return 'unknown';

  const day = osmDayIndex(date);
  const minutes = date.getHours() * 60 + date.getMinutes();
  const yesterday = (day + 6) % 7;

  let mentioned = false;

  for (const rule of rules) {
    if (rule.days.has(day)) {
      mentioned = true;
      if (rule.closed) continue;
      for (const span of rule.spans) {
        if (minutes >= span.from && minutes < span.to) return 'open';
      }
    }
    // a span that began yesterday and runs past midnight covers this morning
    if (rule.days.has(yesterday) && !rule.closed) {
      for (const span of rule.spans) {
        if (span.to > 1440 && minutes + 1440 >= span.from && minutes + 1440 < span.to) return 'open';
      }
    }
  }

  // Every rule parsed, so silence about today genuinely means closed.
  return mentioned || rules.length > 0 ? 'closed' : 'unknown';
}
