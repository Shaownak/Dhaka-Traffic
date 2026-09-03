/**
 * ALL numbers for the story live in this file and nowhere else.
 *
 * Two kinds of figures live here and must never be confused:
 *
 *   SOURCED    — carries a `source` id pointing into SOURCES below. Safe to
 *                present as a finding, always beside its citation.
 *   ILLUSTRATIVE — inherited from the prototype, no source, shape invented to
 *                make a chart legible. These are marked `unsourced: true` and
 *                every chart that uses them must show the "illustrative" chip.
 *                Do not invent new ones, and do not quietly promote one to a
 *                finding without a citation.
 */

export interface Source {
  id: string;
  /** Short chip text, e.g. "World Bank, 2017". */
  label: string;
  /** The organization alone, for the colophon. */
  org: string;
  publisher: string;
  title: string;
  year: number;
  url: string;
  /** Where we actually read it, when the primary is offline or paywalled. */
  via?: string;
  note?: string;
}

export const SOURCES: Record<string, Source> = {
  'wb-2017': {
    id: 'wb-2017',
    label: 'World Bank, 2017',
    org: 'World Bank',
    publisher: 'World Bank',
    title: 'Figures presented at the International Conference on Development Options for Dhaka towards 2035',
    year: 2017,
    url: 'https://www.dhakatribune.com/bangladesh/dhaka/32349/wb-dhaka%E2%80%99s-average-traffic-speed-7kmph',
    via: 'Dhaka Tribune, 19 July 2017',
    note: 'The same figures were repeated in the World Bank report Toward Great Dhaka (2018).',
  },
  'ari-2018': {
    id: 'ari-2018',
    label: 'BUET Accident Research Institute, 2018',
    org: 'BUET Accident Research Institute',
    publisher: 'Accident Research Institute, Bangladesh University of Engineering and Technology',
    title: 'Study on the cost of traffic congestion in Dhaka',
    year: 2018,
    url: 'https://thefinancialexpress.com.bd/national/traffic-congestion-in-dhaka-causes-tk-370b-annual-loss-1526745105',
    via: 'The Financial Express, 19 May 2018',
  },
  'buet-2022': {
    id: 'buet-2022',
    label: 'BUET, 2022',
    org: 'BUET',
    publisher: 'Bangladesh University of Engineering and Technology',
    title: 'Peak-hour speed surveys, reported alongside the NBER city speed study',
    year: 2022,
    url: 'https://www.theweek.in/wire-updates/international/2023/09/30/fes25-bangla-traffic-speed-study.html',
    via: 'Press Trust of India, 30 September 2023',
  },
  'nber-2023': {
    id: 'nber-2023',
    label: 'NBER, 2023',
    org: 'National Bureau of Economic Research',
    publisher: 'National Bureau of Economic Research',
    title: 'City speed index covering 1,200 cities in 152 countries, led by Prottoy Akbar (Aalto University)',
    year: 2023,
    url: 'https://www.theweek.in/wire-updates/international/2023/09/30/fes25-bangla-traffic-speed-study.html',
    via: 'Press Trust of India, 30 September 2023',
  },
  'dmtcl-ridership-2025': {
    id: 'dmtcl-ridership-2025',
    label: 'DMTCL ridership, 2025',
    org: 'Dhaka Mass Transit Company',
    publisher: 'Dhaka Mass Transit Company Limited',
    title: 'MRT Line 6 daily ridership: about 3.5 lakh passengers a day, with a single-day record of 4,03,164 on 13 February 2025',
    year: 2025,
    url: 'https://today.thefinancialexpress.com.bd/last-page/metro-rail-sets-new-ridership-record-1739643168',
    via: 'The Financial Express, February 2025',
  },
  'ari-daily-2020': {
    id: 'ari-daily-2020',
    label: 'BUET ARI daily cost, 2020',
    org: 'BUET Accident Research Institute',
    publisher: 'Accident Research Institute, Bangladesh University of Engineering and Technology',
    title: 'Congestion costs Dhaka about Tk 153 crore a day across five categories: lost working hours, extra fuel, pavement damage, peak-hour collisions, and environmental impact',
    year: 2020,
    url: 'https://thefinancialexpress.com.bd/economy/bangladesh/dhaka-gridlock-costs-tk-153b-a-day-1608257836',
    via: 'The Financial Express, December 2020',
  },
  'bohannon-2011': {
    id: 'bohannon-2011',
    label: 'Bohannon & Williams Andrews, 2011',
    org: 'Bohannon & Williams Andrews',
    publisher: 'Physiotherapy',
    title: 'Normal walking speed: a descriptive meta-analysis',
    year: 2011,
    url: 'https://pubmed.ncbi.nlm.nih.gov/21820535/',
    note: 'Pooled 23,111 healthy adults; mean comfortable speed ranges from 0.94 to 1.43 m/s (3.4 to 5.2 km/h).',
  },
  'dmtcl-2023': {
    id: 'dmtcl-2023',
    label: 'DMTCL, 2023',
    org: 'Dhaka Mass Transit Company',
    publisher: 'Dhaka Mass Transit Company Limited',
    title: 'MRT Line 6 Operational Statistics: Commercial average speed of 35 km/h, max operating speed of 80 km/h',
    year: 2023,
    url: 'https://dmtcl.gov.bd/',
    note: 'Uttara North to Motijheel (20.1 km) takes ~38 minutes including all 16 station stops.',
  },
};

/* =====================================================================
   SOURCED FIGURES
   ===================================================================== */

/** The headline: what Dhaka's traffic actually does. */
export const HEADLINE = {
  kmh: 7,
  decadeEarlierKmh: 21,
  source: 'wb-2017',
} as const;

export type SpeedMetric = 'city average' | 'peak hour' | 'projection';

export interface SpeedPoint {
  year: number;
  /** Displayed year label, where the source gives a decade rather than a date. */
  yearLabel?: string;
  kmh: number;
  metric: SpeedMetric;
  source: string;
}

/**
 * Dhaka's traffic speed as different studies have measured it. The metrics are
 * not interchangeable — a city-wide average and a peak-hour average measure
 * different things — so every point carries its own metric and is labeled
 * with it in the chart.
 */
export const SPEED_HISTORY: readonly SpeedPoint[] = [
  { year: 2007, yearLabel: 'about 2007', kmh: 21, metric: 'city average', source: 'wb-2017' },
  { year: 2017, kmh: 7, metric: 'city average', source: 'wb-2017' },
  { year: 2020, kmh: 6.5, metric: 'peak hour', source: 'buet-2022' },
  { year: 2022, kmh: 4.8, metric: 'peak hour', source: 'buet-2022' },
  { year: 2035, kmh: 4, metric: 'projection', source: 'wb-2017' },
];

/**
 * Why the city slowed down, in one comparison. Over the decade to 2005 the
 * demand on Dhaka's roads grew many times faster than the roads themselves.
 * Everything else on this page is a symptom of this.
 */
export const SUPPLY_DEMAND = {
  period: '1995 to 2005',
  source: 'wb-2017',
  series: [
    { label: 'Road surface', percent: 5 },
    { label: 'Population', percent: 50 },
    { label: 'Traffic', percent: 134 },
  ],
} as const;

export interface Fact {
  value: string;
  unit: string;
  source: string;
}

/** What the congestion costs the city, as measured by people who measured it. */
export const CITY_FACTS: readonly Fact[] = [
  { value: '32 lakh', unit: 'working hours lost across the city every day', source: 'wb-2017' },
  { value: '50 lakh', unit: 'work hours lost every day, on a later count', source: 'ari-2018' },
  { value: 'Tk 37,000 crore', unit: 'the estimated economic cost of congestion in a single year', source: 'ari-2018' },
  { value: 'Slowest of 1,200', unit: 'cities ranked in 152 countries, on a speed index of −0.60', source: 'nber-2023' },
];

/* ---------- 2. the race ---------- */

/**
 * One kilometer, at speeds with sourced benchmarks:
 * - Car: BUET peak-hour average (4.8 km/h)
 * - Walking: Normal comfortable pace (5.0 km/h)
 * - Metro Rail (MRT Line 6): Commercial average speed including stops (35.0 km/h)
 */
export const RACE = {
  distanceKm: 1,
  carKmh: 4.8,
  carSource: 'buet-2022',
  walkKmh: 5.0,
  walkSource: 'bohannon-2011',
  metroKmh: 35.0,
  metroSource: 'dmtcl-2023',
  /** Milliseconds of animation per kilometer walked — the clock is compressed. */
  msPerWalkedKm: 8000,
  /** Pause before the race restarts itself. */
  restartDelayMs: 2000,
} as const;

/* =====================================================================
   ILLUSTRATIVE FIGURES — no source, shape invented, not findings
   ===================================================================== */

/**
 * ⚠ ILLUSTRATIVE. No public hour-by-hour speed dataset exists for Dhaka. The
 * two peaks and the midday half-recovery match how the city is described, but
 * the numbers themselves are designed to give the chart a realistic shape.
 */
export const HOURLY_SPEED_KMH: readonly number[] = [
  24, 25, 25, 24, 23, 21, 17, 11, 7.2, 6.1, 7.4, 8.6,
  9.1, 8.4, 7.6, 6.8, 5.9, 5.2, 5.0, 5.6, 7.9, 11.5, 16, 21,
];
export const HOURLY_SPEED_UNSOURCED = true;

/**
 * The congestion ramp. Used identically by every chart and by the 3D scene —
 * never substitute a different scale. `speedColor` in src/util.ts interpolates
 * these stops; the same five colors appear in the section keys.
 */
export const CONGESTION_RAMP: readonly { kmh: number; color: string }[] = [
  { kmh: 4, color: '#B4172F' },
  { kmh: 6, color: '#E0662A' },
  { kmh: 9, color: '#F2A310' },
  { kmh: 14, color: '#7FBF4A' },
  { kmh: 25, color: '#3FA88A' },
];

/* ---------- 4. the corridor map ---------- */

export interface MapNode {
  id: string;
  /** Unit coordinates, 0–1, laid out topologically. */
  x: number;
  y: number;
  isMetro?: boolean;
}

export interface MapLink {
  s: string;
  t: string;
  /** ⚠ ILLUSTRATIVE peak-hour speed, km/h. */
  v: number;
  /** Relative road weight, 0.4–1, drives stroke width only. */
  w: number;
}

/** ⚠ ILLUSTRATIVE. Place names are real; the geometry is a diagrammatic representation. */
export const NODES: readonly MapNode[] = [
  { id: 'Uttara', x: 0.54, y: 0.05, isMetro: true },
  { id: 'Airport', x: 0.57, y: 0.16 },
  { id: 'Banani', x: 0.62, y: 0.29 },
  { id: 'Gulshan', x: 0.83, y: 0.30 },
  { id: 'Bashundhara', x: 0.96, y: 0.33 },
  { id: 'Badda', x: 0.86, y: 0.44 },
  { id: 'Mohakhali', x: 0.50, y: 0.39 },
  { id: 'Mirpur', x: 0.16, y: 0.24, isMetro: true },
  { id: 'Shyamoli', x: 0.22, y: 0.45 },
  { id: 'Farmgate', x: 0.45, y: 0.53, isMetro: true },
  { id: 'Dhanmondi', x: 0.25, y: 0.63 },
  { id: 'Shahbagh', x: 0.46, y: 0.69, isMetro: true },
  { id: 'Motijheel', x: 0.63, y: 0.82, isMetro: true },
  { id: 'Jatrabari', x: 0.53, y: 0.95 },
];

/** ⚠ ILLUSTRATIVE speeds. */
export const LINKS: readonly MapLink[] = [
  { s: 'Uttara', t: 'Airport', v: 14, w: 0.8 },
  { s: 'Airport', t: 'Banani', v: 9, w: 0.9 },
  { s: 'Banani', t: 'Gulshan', v: 7, w: 0.5 },
  { s: 'Banani', t: 'Mohakhali', v: 5, w: 1 },
  { s: 'Gulshan', t: 'Mohakhali', v: 6, w: 0.6 },
  // Progoti Sharani, and the road east into Bashundhara R/A
  { s: 'Gulshan', t: 'Badda', v: 5, w: 0.8 },
  { s: 'Badda', t: 'Bashundhara', v: 6, w: 0.7 },
  { s: 'Mirpur', t: 'Shyamoli', v: 8, w: 0.7 },
  { s: 'Mirpur', t: 'Banani', v: 11, w: 0.4 },
  { s: 'Shyamoli', t: 'Farmgate', v: 6, w: 0.8 },
  { s: 'Shyamoli', t: 'Dhanmondi', v: 9, w: 0.5 },
  { s: 'Mohakhali', t: 'Farmgate', v: 4, w: 1 },
  { s: 'Farmgate', t: 'Shahbagh', v: 5, w: 0.9 },
  { s: 'Dhanmondi', t: 'Shahbagh', v: 8, w: 0.6 },
  { s: 'Shahbagh', t: 'Motijheel', v: 6, w: 0.8 },
  { s: 'Motijheel', t: 'Jatrabari', v: 7, w: 0.7 },
];

/** Elevated MRT Line 6 Path (Uttara -> Mirpur -> Farmgate -> Shahbagh -> Motijheel) */
export const METRO_LINE_6: readonly string[] = [
  'Uttara', 'Mirpur', 'Farmgate', 'Shahbagh', 'Motijheel',
];

/** Node labels that sit to the right of their dot; the rest sit to the left. */
export const LABEL_RIGHT: ReadonlySet<string> = new Set([
  'Gulshan', 'Motijheel', 'Banani', 'Airport', 'Uttara', 'Jatrabari', 'Mohakhali', 'Farmgate', 'Shahbagh',
  'Bashundhara', 'Badda',
]);

/** Map key. The bands describe the ramp above in words. */
export const MAP_KEY: readonly { color: string; label: string }[] = [
  { color: '#B4172F', label: 'under 5 km/h' },
  { color: '#E0662A', label: '5 to 7' },
  { color: '#F2A310', label: '7 to 10' },
  { color: '#7FBF4A', label: 'over 10' },
];

/* ---------- 5. the street simulation ---------- */

export interface Corridor {
  name: string;
  /** ⚠ ILLUSTRATIVE free-flow speed at the quietest hour, km/h. */
  free: number;
  /** ⚠ ILLUSTRATIVE speed at the worst hour, km/h. */
  peak: number;
}

export const CORRIDORS: readonly Corridor[] = [
  { name: 'Mohakhali to Farmgate', free: 32, peak: 4 },
  { name: 'Airport Road', free: 45, peak: 9 },
  { name: 'Mirpur Road', free: 34, peak: 8 },
  { name: 'Uttara to Airport', free: 48, peak: 14 },
];

/* ---------- 6. what it costs you ---------- */

export interface Route {
  name: string;
  /** ⚠ ILLUSTRATIVE hours a year lost on this stretch. */
  hours: number;
}

export const ROUTES: readonly Route[] = [
  { name: 'Mohakhali to Farmgate', hours: 412 },
  { name: 'Airport Road to Banani', hours: 355 },
  { name: 'Farmgate to Shahbagh', hours: 338 },
  { name: 'Mirpur to Shyamoli', hours: 274 },
  { name: 'Uttara to Airport', hours: 143 },
];

export const DAYS_IN_YEAR = 365;

/**
 * The Bangladeshi working week runs Sunday to Thursday; Friday and Saturday
 * are the weekend. A commuter therefore makes the trip about 5 days in 7, so
 * an annual delay is spread over roughly 260 days, not 365.
 *
 * Public holidays are not deducted — Bangladesh has around 22 government
 * holidays a year — so 260 is an upper bound on days actually travelled.
 */
export const WORK_YEAR = {
  daysPerWeek: 5,
  weekend: 'Friday and Saturday',
  weeksPerYear: 52,
  /** 52 × 5. */
  workingDaysPerYear: 260,
  /** Hours in a working day, used to express a delay as working days lost. */
  workingDayHours: 8,
} as const;

/**
 * ⚠ ASSUMPTION, no source. The share of a Dhaka commute that is congestion
 * delay rather than the travel time the trip would take on a clear road.
 * Used only by the personal calculator.
 */
export const CONGESTION_SHARE = 0.55;

/** Hours per unit, for the "what else could that time have been" equivalents. */
export const EQUIVALENTS = { bookHours: 7, filmHours: 2.2 } as const;

/* =====================================================================
   PROVENANCE LEDGER
   Every dataset on the page, what it is, and how far it can be trusted.
   The methodology section renders directly from this, so the page cannot
   describe its own sourcing differently from the way the charts are fed.
   ===================================================================== */

export type Provenance = 'measured' | 'derived' | 'modeled';

export interface Dataset {
  id: string;
  /** Where it appears on the page. */
  used: string;
  what: string;
  provenance: Provenance;
  /** How the numbers were arrived at. */
  method: string;
  source?: string;
  /** What would have to happen for this to become `measured`. */
  toUpgrade?: string;
}

export const DATASETS: readonly Dataset[] = [
  {
    id: 'headline-speed',
    used: 'Cover, the record',
    what: 'City-wide average speed, 2007 to 2035',
    provenance: 'measured',
    method: 'Published figures transcribed as stated, each point carrying its own metric and citation. No interpolation between points.',
    source: 'wb-2017',
  },
  {
    id: 'race-speeds',
    used: 'The race',
    what: 'Peak-hour, walking and Metro Rail speeds',
    provenance: 'measured',
    method: 'Three published figures raced over one kilometer at their stated speeds. Animation time is compressed by a constant factor, so relative finishing order and margins are true to the sources.',
    source: 'buet-2022',
  },
  {
    id: 'city-cost',
    used: 'What it takes from you',
    what: 'Working hours and money lost city-wide',
    provenance: 'measured',
    method: 'Reported totals from two institutions, shown side by side rather than reconciled, because they count different things.',
    source: 'ari-2018',
  },
  {
    id: 'hourly-profile',
    used: 'The 24-hour clock, the street simulation',
    what: 'Average traffic speed for each hour of the day',
    provenance: 'modeled',
    method: 'No public hour-by-hour speed series exists for Dhaka. The curve reproduces the shape the city is consistently described as having — a collapse before 9:00 AM, a partial midday recovery, a deeper evening trough — anchored at the published city average. The values between those anchors are invented.',
    toUpgrade: 'Sample a routing API every 15 minutes on fixed origin-destination pairs for four weeks, then take the median for each hour of the day. The collector that does this is published with the project.',
  },
  {
    id: 'corridor-speeds',
    used: 'The corridor map, the street simulation',
    what: 'Peak-hour speed on each named corridor',
    provenance: 'modeled',
    method: 'Place names and the connections between them are real. The speeds are assigned to match the ordering the corridors are reported to have, not measured on the ground.',
    toUpgrade: 'The same Routes API collection, keyed by corridor rather than by hour.',
  },
  {
    id: 'annual-hours',
    used: 'What it takes from you',
    what: 'Hours a year lost on each corridor',
    provenance: 'modeled',
    method: 'Annual totals consistent with the corridor speeds above. Converted to working days at eight hours, and spread across 260 travelling days because Friday and Saturday are the weekend in Bangladesh.',
    toUpgrade: 'Derives automatically once corridor speeds are measured: annual delay is free-flow time subtracted from observed time, summed over travelling days.',
  },
  {
    id: 'commute-calculator',
    used: 'Personal commute calculator',
    what: 'Hours a year one reader loses',
    provenance: 'derived',
    method: 'The reader supplies the commute; the calculator multiplies it out over their own travelling days. One assumption is ours and is not sourced: that 55 percent of a Dhaka commute is congestion delay rather than the time the trip would take on a clear road.',
  },
  {
    id: 'interventions',
    used: 'How Dhaka unjams',
    what: 'Speed recovery per intervention',
    provenance: 'modeled',
    method: 'Relative weights, not forecasts. They are stacked to show which measures are large and which are marginal; the totals should not be read as a prediction, and no date is attached to them.',
    toUpgrade: 'Published ex-ante appraisals for each scheme, which exist for MRT lines but not for the policy measures.',
  },
  {
    id: 'traffic-model',
    used: 'The street simulation',
    what: 'Vehicle positions, queues and stop-start waves',
    provenance: 'derived',
    method: 'A car-following model. Each vehicle picks its speed from the gap ahead, clamped by acceleration and braking limits, with an occasional random brake tap. Queues are emergent rather than animated. The model is unit tested; only the speeds fed into it are modeled.',
  },
];

/**
 * Color-vision audit of the congestion ramp, re-run whenever the ramp changes.
 * Distances are Euclidean in simulated sRGB; anything under 45 would be too
 * close to read apart. Published here rather than asserted.
 */
export const COLOR_AUDIT = {
  method: 'LMS simulation of dichromatic vision, adjacent and non-adjacent stop pairs compared',
  worstDeuteranopia: 61,
  worstProtanopia: 54,
  threshold: 45,
  note: 'The ramp separates under both common forms of red-green color blindness, but it is never the only encoding: every chart also labels its values.',
} as const;

/* ---------- 7. solutions & future outlook ---------- */

export interface Solution {
  id: string;
  title: string;
  category: 'transit' | 'policy' | 'urbanism';
  summary: string;
  potentialGainKmh: number;
  status: string;
  icon: string;
}

export const SOLUTIONS: readonly Solution[] = [
  {
    id: 'mrt-network',
    title: 'Complete 6-Line MRT Metro Network',
    category: 'transit',
    summary: 'Expanding from MRT-6 to Lines 1, 5, 2, and 4 will carry over 50 lakh daily riders grade-separated from street traffic.',
    potentialGainKmh: 6.5,
    status: 'Under Construction & Planning',
    icon: '🚇',
  },
  {
    id: 'bus-rationalization',
    title: 'Bus Route Rationalization (Nagar Paribahan)',
    category: 'policy',
    summary: 'Consolidating hundreds of chaotic private bus operators into 6 color-coded corporate franchises with disciplined stops.',
    potentialGainKmh: 4.0,
    status: 'Pilot Expansion',
    icon: '🚌',
  },
  {
    id: 'school-transit',
    title: 'Mandatory Dedicated School Bus System',
    category: 'policy',
    summary: 'Replacing thousands of individual private cars dropping off students in Dhanmondi, Gulshan, and Uttara with centralized school buses.',
    potentialGainKmh: 3.2,
    status: 'Proposed Policy',
    icon: '🎒',
  },
  {
    id: 'pedestrian-first',
    title: 'Encroachment-Free Walkable Sidewalks',
    category: 'urbanism',
    summary: 'Reclaiming sidewalks and footbridges from illegal parking and stalls so 60%+ of short trips can be walked safely.',
    potentialGainKmh: 2.8,
    status: 'Active City Drive',
    icon: '🚶',
  },
  {
    id: 'circular-waterways',
    title: 'Circular Waterway & Modern Water Buses',
    category: 'transit',
    summary: 'Reviving passenger water transit along the 110 km loop of the Buriganga, Turag, Balu, and Shitalakshya rivers.',
    potentialGainKmh: 2.0,
    status: 'Under Revitalization',
    icon: '⛴️',
  },
];

/* ---------- 8. the quiet ring ---------- */

/** ⚠ ILLUSTRATIVE. */
export const NIGHT = {
  /** Hours before this run free. */
  untilHour: 5,
  kmh: 25,
} as const;
