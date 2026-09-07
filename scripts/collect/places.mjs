#!/usr/bin/env node
/**
 * COLLECT PLACES — restaurants and cafes from OpenStreetMap, via Overpass.
 *
 *   node scripts/collect/places.mjs [--dry-run]
 *
 * Why OSM and not a commercial places API: the data is openly licensed (ODbL),
 * so it can be committed to the repository, cited, and fact-checked. A
 * commercial API's results generally cannot be cached or redistributed, which
 * would force the page to call it live — and a static page cannot hide a key.
 *
 * WHAT THIS DOES NOT GIVE YOU. OSM has no ratings, no live occupancy, and its
 * opening hours are sparse and often stale. The stop optimizer therefore ranks
 * on journey disruption, which we compute ourselves, and treats anything OSM
 * says about quality or opening as absent unless the tag is actually present.
 * Nothing downstream is allowed to invent those fields.
 *
 * ATTRIBUTION. ODbL requires it. The page credits OpenStreetMap contributors
 * wherever these places appear.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

/** Greater Dhaka, generous enough to cover every place in the network. */
const BBOX = { south: 23.66, west: 90.31, north: 23.92, east: 90.50 };

/**
 * The categories a traveller would actually break a journey for. `fast_food`
 * is included because in Dhaka it covers a great deal of ordinary sit-down
 * eating, not only chains.
 */
const CATEGORIES = [
  { key: 'amenity', value: 'restaurant', kind: 'restaurant' },
  { key: 'amenity', value: 'cafe', kind: 'cafe' },
  { key: 'amenity', value: 'fast_food', kind: 'fast_food' },
];

const OUT = 'src/data/measured/places.json';

const bboxClause = `(${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east})`;

function query() {
  const parts = CATEGORIES
    .map((c) => `  nwr["${c.key}"="${c.value}"]${bboxClause};`)
    .join('\n');
  // `out center` gives ways and relations a single representative point, which
  // is all the router needs.
  return `[out:json][timeout:180];\n(\n${parts}\n);\nout center tags;`;
}

function kindOf(tags) {
  for (const c of CATEGORIES) {
    if (tags[c.key] === c.value) return c.kind;
  }
  return 'restaurant';
}

/**
 * Only fields OSM actually stated. A missing tag stays missing — it is never
 * defaulted to something that reads like a measurement.
 */
function normalize(el) {
  const tags = el.tags ?? {};
  const name = tags['name:en'] ?? tags.name;
  if (!name) return null; // an unnamed point is useless to a reader

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  const place = {
    id: `osm:${el.type}/${el.id}`,
    name: String(name).trim(),
    kind: kindOf(tags),
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
  };

  // Optional, and genuinely optional: present only when OSM says so.
  if (tags.cuisine) place.cuisine = tags.cuisine.split(';')[0].trim();
  if (tags.opening_hours) place.openingHours = tags.opening_hours;
  if (tags['addr:street']) place.street = tags['addr:street'];
  if (tags.website || tags['contact:website']) {
    place.website = tags.website ?? tags['contact:website'];
  }
  return place;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const q = query();

  if (dryRun) {
    console.log('Would POST to', ENDPOINT);
    console.log(q);
    return;
  }

  console.log('Querying Overpass for places across Dhaka...');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Overpass asks for a identifying agent; be honest about who is calling.
      'User-Agent': 'dhaka-journey-optimizer/0.1 (open data, non-commercial dev)',
    },
    body: 'data=' + encodeURIComponent(q),
  });

  if (!res.ok) {
    console.error(`Overpass returned ${res.status} ${res.statusText}`);
    process.exitCode = 1;
    return;
  }

  const json = await res.json();
  const raw = json.elements ?? [];
  const places = raw.map(normalize).filter(Boolean);

  // Deduplicate by name + rounded position: OSM often carries both a node and
  // the building way for the same establishment.
  const seen = new Map();
  for (const p of places) {
    const key = `${p.name.toLowerCase()}|${p.lat.toFixed(3)}|${p.lon.toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, p);
  }
  const deduped = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));

  const byKind = {};
  for (const p of deduped) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;

  const payload = {
    note: 'Collected from OpenStreetMap via Overpass by scripts/collect/places.mjs. '
      + 'Positions and names are as OSM states them. OSM carries no ratings and no '
      + 'live availability, so this file has none; anything the optimizer reports '
      + 'about quality or opening comes from a tag actually present here.',
    source: 'OpenStreetMap contributors',
    license: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors',
    collectedAt: new Date().toISOString(),
    bbox: BBOX,
    counts: { returned: raw.length, usable: deduped.length, byKind },
    places: deduped,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 0) + '\n');

  console.log(`Overpass returned ${raw.length} elements.`);
  console.log(`Kept ${deduped.length} named, positioned places:`);
  for (const [kind, n] of Object.entries(byKind)) console.log(`  ${kind.padEnd(12)} ${n}`);
  console.log(`Wrote ${OUT}`);
  const withHours = deduped.filter((p) => p.openingHours).length;
  const withCuisine = deduped.filter((p) => p.cuisine).length;
  console.log(`  opening hours stated: ${withHours} (${Math.round(withHours / deduped.length * 100)}%)`);
  console.log(`  cuisine stated:       ${withCuisine} (${Math.round(withCuisine / deduped.length * 100)}%)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
