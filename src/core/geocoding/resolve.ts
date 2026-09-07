/* =====================================================================
   GEOCODING — turning what somebody typed into a place on the network

   Deliberately a lookup over the known network, not a general geocoder. The
   router can only start and finish at junctions it knows, so resolving "some
   address in Banasree" to a precise coordinate would be false precision: the
   journey would still be planned from the nearest modelled junction.

   Returning an honest "I do not know that place, did you mean one of these"
   is better than silently snapping a stranger's address to a junction three
   kilometres away and costing the trip as though it started there.
   ===================================================================== */
import { PLACES, type Place } from '../../data/network';

export interface GeocodeMatch {
  place: Place;
  /** 0-1. 1 is an exact name or a known alias. */
  confidence: number;
  /** How it was matched, for the explanation and for debugging. */
  how: 'id' | 'exact' | 'alias' | 'prefix' | 'contains' | 'token';
}

export interface GeocodeResult {
  query: string;
  match: GeocodeMatch | null;
  /** Other plausible readings, best first. Non-empty when the query is vague. */
  alternatives: GeocodeMatch[];
  /** True when several candidates are close enough that picking one is a guess. */
  ambiguous: boolean;
}

/**
 * Everyday names for junctions the network calls something else.
 *
 * "Mirpur" is the case that matters: it is a large area and the network has
 * one junction in it, so the alias is an approximation and the planner says
 * which junction it used rather than pretending "Mirpur" is a point.
 */
const ALIASES: Record<string, string> = {
  mirpur: 'mirpur10',
  'mirpur 10': 'mirpur10',
  'mirpur10': 'mirpur10',
  'mirpur ten': 'mirpur10',
  'gulshan 1': 'gulshan',
  'gulshan 2': 'gulshan',
  'gulshan circle': 'gulshan',
  'gulshan avenue': 'gulshan',
  banasree: 'rampura',
  'hatirjheel': 'rampura',
  niketan: 'gulshan',
  baridhara: 'badda',
  'notun bazar': 'badda',
  bashundhara: 'bashundhara',
  'bashundhara ra': 'bashundhara',
  'bashundhara residential area': 'bashundhara',
  dhanmondi: 'dhanmondi',
  'dhanmondi 27': 'dhanmondi',
  'dhanmondi 32': 'dhanmondi',
  'shahbag': 'shahbagh',
  'shahbagh': 'shahbagh',
  'science lab': 'dhanmondi',
  'new market': 'newmarket',
  newmarket: 'newmarket',
  nilkhet: 'newmarket',
  'old dhaka': 'sadarghat',
  puran: 'sadarghat',
  'purana paltan': 'paltan',
  motijheel: 'motijheel',
  'zero point': 'paltan',
  gulistan: 'motijheel',
  uttara: 'uttara',
  'uttara sector': 'uttara',
  airport: 'airport',
  'hazrat shahjalal': 'airport',
  'shahjalal airport': 'airport',
  'dhaka airport': 'airport',
  kuril: 'kuril',
  'kuril bishwa road': 'kuril',
  'jatra bari': 'jatrabari',
  jatrabari: 'jatrabari',
  'tejgaon industrial': 'tejgaon',
  'farm gate': 'farmgate',
  farmgate: 'farmgate',
  'karwan bazar': 'farmgate',
  'kawran bazar': 'farmgate',
  mohakhali: 'mohakhali',
  'mohakhali dohs': 'mohakhali',
  banani: 'banani',
  'banani dohs': 'banani',
  agargaon: 'agargaon',
  'shere bangla nagar': 'agargaon',
  shyamoli: 'shyamoli',
  'adabor': 'shyamoli',
  mohammadpur: 'mohammadpur',
  'lalmatia': 'mohammadpur',
  azimpur: 'azimpur',
  'dhaka university': 'shahbagh',
  'buet': 'azimpur',
  malibagh: 'malibagh',
  'moghbazar': 'malibagh',
  khilgaon: 'khilgaon',
  rampura: 'rampura',
  badda: 'badda',
  khilkhet: 'khilkhet',
  kazipara: 'kazipara',
  'shewrapara': 'kazipara',
  sadarghat: 'sadarghat',
  postogola: 'postogola',
  'postagola': 'postogola',
  paltan: 'paltan',
};

const byId = new Map(PLACES.map((p) => [p.id, p]));

/** Lowercase, strip punctuation, collapse whitespace. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const normalizedNames = PLACES.map((p) => ({ place: p, key: normalize(p.name) }));

/** Resolve one query against the network. */
export function geocode(query: string): GeocodeResult {
  const raw = (query ?? '').trim();
  const key = normalize(raw);
  const empty: GeocodeResult = { query: raw, match: null, alternatives: [], ambiguous: false };
  if (!key) return empty;

  // 1. an exact place id, which is what the UI passes
  const byIdHit = byId.get(raw) ?? byId.get(key.replace(/\s/g, ''));
  if (byIdHit) {
    return { query: raw, match: { place: byIdHit, confidence: 1, how: 'id' }, alternatives: [], ambiguous: false };
  }

  // 2. an exact display name
  const exact = normalizedNames.find((n) => n.key === key);
  if (exact) {
    return { query: raw, match: { place: exact.place, confidence: 1, how: 'exact' }, alternatives: [], ambiguous: false };
  }

  // 3. a known everyday name
  const aliased = ALIASES[key];
  if (aliased) {
    const place = byId.get(aliased);
    if (place) {
      return { query: raw, match: { place, confidence: 0.95, how: 'alias' }, alternatives: [], ambiguous: false };
    }
  }

  // 4. fuzzier matching, scored so the caller can see how sure this is
  const scored: GeocodeMatch[] = [];
  for (const { place, key: name } of normalizedNames) {
    if (name.startsWith(key) || key.startsWith(name)) {
      scored.push({ place, confidence: 0.8, how: 'prefix' });
      continue;
    }
    if (name.includes(key) || key.includes(name)) {
      scored.push({ place, confidence: 0.65, how: 'contains' });
      continue;
    }
    const queryTokens = new Set(key.split(' '));
    const nameTokens = name.split(' ');
    const shared = nameTokens.filter((t) => queryTokens.has(t)).length;
    if (shared > 0) {
      scored.push({ place, confidence: 0.4 * (shared / nameTokens.length), how: 'token' });
    }
  }

  // alias keys can also match loosely: "going to mirpur ten" contains an alias
  for (const [alias, id] of Object.entries(ALIASES)) {
    if (!key.includes(alias)) continue;
    const place = byId.get(id);
    if (!place) continue;
    if (scored.some((s) => s.place.id === id && s.confidence >= 0.7)) continue;
    scored.push({ place, confidence: 0.7, how: 'alias' });
  }

  if (!scored.length) return empty;

  // best per place, then best overall; ties break on name so it is deterministic
  const best = new Map<string, GeocodeMatch>();
  for (const m of scored) {
    const existing = best.get(m.place.id);
    if (!existing || m.confidence > existing.confidence) best.set(m.place.id, m);
  }
  const ranked = [...best.values()].sort(
    (a, b) => b.confidence - a.confidence || a.place.name.localeCompare(b.place.name),
  );

  const top = ranked[0]!;
  const runnerUp = ranked[1];
  const ambiguous = runnerUp !== undefined && runnerUp.confidence >= top.confidence - 0.05;

  return {
    query: raw,
    match: top,
    alternatives: ranked.slice(1, 5),
    ambiguous,
  };
}

/** Every place, for populating a picker. */
export function allPlaces(): readonly Place[] {
  return PLACES;
}

export interface PlaceMention {
  place: Place;
  /** Index in the normalized text where the mention starts. */
  at: number;
  /** The words that matched. */
  text: string;
}

/**
 * Every place named anywhere in a sentence, in the order they appear.
 *
 * The natural-language layer needs this rather than `geocode`, because it does
 * not yet know which mention is the origin and which the destination — that is
 * decided from the words around them.
 *
 * Longer names win over shorter ones at the same position, so "Mirpur 10" is
 * not read as "Mirpur" with a stray digit.
 */
export function findPlaceMentions(text: string): PlaceMention[] {
  const key = normalize(text);
  if (!key) return [];

  const needles: { needle: string; id: string }[] = [
    ...normalizedNames.map((n) => ({ needle: n.key, id: n.place.id })),
    ...Object.entries(ALIASES).map(([alias, id]) => ({ needle: normalize(alias), id })),
  ].sort((a, b) => b.needle.length - a.needle.length);

  const found: PlaceMention[] = [];
  /** Character ranges already claimed, so one span yields one place. */
  const claimed: [number, number][] = [];

  const overlaps = (from: number, to: number): boolean =>
    claimed.some(([a, b]) => from < b && to > a);

  for (const { needle, id } of needles) {
    if (!needle) continue;
    const place = byId.get(id);
    if (!place) continue;

    let from = key.indexOf(needle);
    while (from !== -1) {
      const to = from + needle.length;
      // whole words only: "banani" must not match inside a longer word
      const before = from === 0 || key[from - 1] === ' ';
      const after = to === key.length || key[to] === ' ';
      if (before && after && !overlaps(from, to)) {
        claimed.push([from, to]);
        found.push({ place, at: from, text: needle });
      }
      from = key.indexOf(needle, from + 1);
    }
  }

  return found.sort((a, b) => a.at - b.at);
}

/** The normalized form used for matching, exposed so the parser agrees with it. */
export function normalizeQuery(text: string): string {
  return normalize(text);
}
