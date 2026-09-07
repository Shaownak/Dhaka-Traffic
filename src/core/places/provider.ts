/* =====================================================================
   PLACES — somewhere to stop, from OpenStreetMap

   The dataset is real: 2,300-odd named, positioned eating places collected
   from OSM by scripts/collect/places.mjs and committed under an open licence.

   WHAT OSM DOES NOT CARRY, and what this module therefore refuses to invent:

     ratings          there are none, so nothing here is ranked "by quality"
     live occupancy   there is none, so nothing claims a table is free
     reliable hours   only about one place in six states opening hours at all

   The stop optimizer works around that by ranking on journey disruption, which
   we compute ourselves from the routing graph and can stand behind. Where OSM
   is silent the answer is "unknown", which is a different thing from "no" and
   is presented that way.

   The dataset is 66 KB gzipped, so it is loaded on demand rather than bundled
   into the initial payload — a reader who never asks for a stop never pays for
   it.
   ===================================================================== */
import { haversineKm, type LatLon } from '../geo';

export type PlaceKind = 'restaurant' | 'cafe' | 'fast_food';

export interface Poi {
  id: string;
  name: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  /** Present only when OSM states it. */
  cuisine?: string;
  openingHours?: string;
  street?: string;
  website?: string;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface PlacesProvider {
  readonly id: string;
  readonly attribution: string;
  /** Fetch the dataset. Safe to call repeatedly; the work happens once. */
  load(): Promise<boolean>;
  /** Whether a lookup can answer right now. */
  isReady(): boolean;
  /** How many places are loaded. */
  count(): number;
  /** Everything inside a bounding box. Cheap prefilter before exact distance. */
  within(bounds: Bounds, kinds?: readonly PlaceKind[]): Poi[];
  /** The nearest places to a point, closest first. */
  near(point: LatLon, radiusKm: number, kinds?: readonly PlaceKind[]): Poi[];
}

interface PlacesFile {
  attribution?: string;
  collectedAt?: string;
  places?: Poi[];
}

/* ---------- the OSM-backed implementation ---------- */

let loaded: Poi[] | null = null;
let loading: Promise<boolean> | null = null;
let attribution = '© OpenStreetMap contributors';
let collectedAt: string | null = null;

/**
 * A coarse grid over the city so a corridor search does not scan every place.
 * Cell size is about a kilometre, which keeps buckets small without making the
 * index bigger than the data.
 */
const CELL = 0.01; // degrees, roughly 1.1 km north-south
const grid = new Map<string, Poi[]>();

const cellKey = (lat: number, lon: number): string =>
  `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`;

function indexAll(places: readonly Poi[]): void {
  grid.clear();
  for (const p of places) {
    const key = cellKey(p.lat, p.lon);
    const bucket = grid.get(key);
    if (bucket) bucket.push(p);
    else grid.set(key, [p]);
  }
}

export const osmPlaces: PlacesProvider = {
  id: 'osm-overpass',
  get attribution() {
    return attribution;
  },

  async load(): Promise<boolean> {
    if (loaded) return true;
    if (loading) return loading;

    loading = (async () => {
      try {
        // Split out of the initial bundle on purpose; see the header.
        const module = await import('../../data/measured/places.json');
        const file = (module.default ?? module) as PlacesFile;
        const places = file.places ?? [];
        if (!places.length) return false;
        loaded = places;
        if (file.attribution) attribution = file.attribution;
        collectedAt = file.collectedAt ?? null;
        indexAll(places);
        return true;
      } catch {
        // A missing or unreadable dataset means no stops can be offered. It
        // must never mean invented ones.
        loaded = null;
        return false;
      } finally {
        loading = null;
      }
    })();

    return loading;
  },

  isReady(): boolean {
    return loaded !== null && loaded.length > 0;
  },

  count(): number {
    return loaded?.length ?? 0;
  },

  within(bounds: Bounds, kinds?: readonly PlaceKind[]): Poi[] {
    if (!loaded) return [];
    const out: Poi[] = [];
    const latFrom = Math.floor(bounds.south / CELL);
    const latTo = Math.floor(bounds.north / CELL);
    const lonFrom = Math.floor(bounds.west / CELL);
    const lonTo = Math.floor(bounds.east / CELL);

    for (let la = latFrom; la <= latTo; la++) {
      for (let lo = lonFrom; lo <= lonTo; lo++) {
        const bucket = grid.get(`${la}:${lo}`);
        if (!bucket) continue;
        for (const p of bucket) {
          if (p.lat < bounds.south || p.lat > bounds.north) continue;
          if (p.lon < bounds.west || p.lon > bounds.east) continue;
          if (kinds && !kinds.includes(p.kind)) continue;
          out.push(p);
        }
      }
    }
    return out;
  },

  near(point: LatLon, radiusKm: number, kinds?: readonly PlaceKind[]): Poi[] {
    const degLat = radiusKm / 110.574;
    const degLon = radiusKm / (111.32 * Math.cos((point.lat * Math.PI) / 180));
    const candidates = this.within(
      {
        south: point.lat - degLat,
        north: point.lat + degLat,
        west: point.lon - degLon,
        east: point.lon + degLon,
      },
      kinds,
    );
    return candidates
      .map((p) => ({ p, km: haversineKm(point, p) }))
      .filter((c) => c.km <= radiusKm)
      .sort((a, b) => a.km - b.km)
      .map((c) => c.p);
  },
};

/** When the dataset was collected, for the provenance line. */
export function placesCollectedAt(): string | null {
  return collectedAt;
}

/** Test seam: load a dataset directly instead of fetching the bundled one. */
export function loadPlacesForTest(places: readonly Poi[]): void {
  loaded = [...places];
  indexAll(loaded);
}
