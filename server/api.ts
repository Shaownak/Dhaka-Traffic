/* =====================================================================
   HTTP API — the same engine the page uses, over the wire

   A thin transport layer and nothing more. Every endpoint parses a request,
   hands it to the core, and serialises what comes back. There is no routing
   logic here, no scoring, and no second opinion about anything the planner
   decided — if the API and the page ever disagreed, one of them would be
   wrong, and this is the design that makes that impossible.

   Deliberately dependency-free: Node's own http server. A framework would earn
   its weight at the point there is auth, sessions or a database to manage, and
   there is none of that yet.

   Run it with:  npm run api
   ===================================================================== */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PLACES, ROADS } from '../src/data/network';
import { PREFERENCES, STOP_SEARCH } from '../src/data/intelligence';
import { geocode } from '../src/core/geocoding/resolve';
import { planJourney } from '../src/core/journey/planner';
import { JourneyError } from '../src/core/journey/types';
import { PLACE_KINDS } from '../src/core/nl/schema';
import { parseJourneyText } from '../src/core/nl/parse';
import { dateFrom, toJourneyRequest, type RawJourneyBody } from './request';
import { osmPlaces, type PlaceKind } from '../src/core/places/provider';
import { departureCurve, fastestRoute, routeOptions, dayTypeOf } from '../src/core/routing/graph';
import { availableTiers, estimateLeg, hasProfileData, hasProviderData, TIER_ORDER, TIER_LABEL } from '../src/core/traffic/hierarchy';
import { openMeteo, weatherNote } from '../src/core/weather/provider';

const PORT = Number(process.env.PORT ?? 8787);
const STARTED = new Date();
const weather = openMeteo();

/* ---------- plumbing ---------- */

interface Handled {
  status: number;
  body: unknown;
}

function ok(body: unknown): Handled {
  return { status: 200, body };
}

/**
 * Errors carry a code and a message and nothing else.
 * No stack traces, no file paths, no internal state.
 */
function fail(status: number, code: string, message: string, detail?: unknown): Handled {
  return { status, body: detail === undefined ? { error: { code, message } } : { error: { code, message, detail } } };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // a journey request is a few hundred bytes; anything larger is a mistake
    if (size > 64 * 1024) throw new Error('TOO_LARGE');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('INVALID_BODY');
  return body;
}

function coordinate(value: string | null, max: number): number {
  if (value === null || !value.trim()) return NaN;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= max ? number : NaN;
}

/* ---------- endpoints ---------- */

async function handle(method: string, url: URL, req: IncomingMessage): Promise<Handled> {
  const path = url.pathname.replace(/\/+$/, '') || '/';

  /* --- health and status --- */
  if (method === 'GET' && path === '/api/health') {
    return ok({ status: 'ok', uptimeSeconds: Math.round((Date.now() - STARTED.getTime()) / 1000) });
  }

  if (method === 'GET' && path === '/api/system/status') {
    await osmPlaces.load();
    return ok({
      status: 'ok',
      startedAt: STARTED.toISOString(),
      network: { places: PLACES.length, roads: ROADS.length },
      traffic: {
        // The honest inventory: what can actually answer, and what cannot.
        tiersAvailable: availableTiers(),
        tiersUnavailable: TIER_ORDER.filter(tier => !availableTiers().includes(tier)),
        collectedJourneyTimes: hasProfileData(),
        note: hasProfileData()
          ? 'Some roads have collected journey times; the rest use the modeled baseline.'
          : hasProviderData() ? 'Provider forecasts are available, but no journey times have been observed.'
          : 'No journey times have been collected. Every estimate uses the modeled baseline.',
      },
      places: {
        loaded: osmPlaces.isReady(),
        count: osmPlaces.count(),
        attribution: osmPlaces.attribution,
      },
      weather: { provider: 'open-meteo', appliedToTravelTimes: false },
      preferences: PREFERENCES.map((p) => ({ id: p.id, label: p.label })),
    });
  }

  /* --- geocoding --- */
  if (method === 'GET' && path === '/api/geocode') {
    const q = url.searchParams.get('q');
    if (!q) return fail(400, 'MISSING_QUERY', 'Pass ?q= with a place to look up.');
    const result = geocode(q);
    return ok({
      query: result.query,
      match: result.match && {
        id: result.match.place.id,
        name: result.match.place.name,
        lat: result.match.place.lat,
        lon: result.match.place.lon,
        confidence: result.match.confidence,
        matchedBy: result.match.how,
      },
      ambiguous: result.ambiguous,
      alternatives: result.alternatives.map((a) => ({
        id: a.place.id, name: a.place.name, confidence: a.confidence,
      })),
    });
  }

  if (method === 'GET' && path === '/api/places') {
    return ok({ places: PLACES.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon })) });
  }

  /* --- POI search --- */
  if (method === 'GET' && path === '/api/places/search') {
    const lat = coordinate(url.searchParams.get('lat'), 90);
    const lon = coordinate(url.searchParams.get('lon'), 180);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return fail(400, 'MISSING_POINT', 'Pass ?lat= and ?lon=.');
    }
    const radiusKm = Number(url.searchParams.get('radiusKm') ?? 1.5);
    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 10) return fail(400, 'BAD_RADIUS', 'radiusKm must be greater than 0 and at most 10.');
    const kindParam = url.searchParams.get('kind');
    const kinds = kindParam ? (kindParam.split(',') as PlaceKind[]) : undefined;

    if (kinds?.some(k => !PLACE_KINDS.includes(k))) return fail(400, 'BAD_KIND', 'Unknown place kind.');
    // The dataset is restricted to Dhaka. Avoid unbounded polar grid queries.
    if (lat < 23 || lat > 25 || lon < 89 || lon > 92) return ok({ count: 0, attribution: osmPlaces.attribution, places: [] });
    const loaded = await osmPlaces.load();
    if (!loaded) {
      return fail(503, 'NO_PLACES_DATASET',
        'No places dataset is available. Run scripts/collect/places.mjs to collect one.');
    }
    const found = osmPlaces.near({ lat, lon }, radiusKm, kinds).slice(0, 50);
    return ok({ count: found.length, attribution: osmPlaces.attribution, places: found });
  }

  /* --- raw routing --- */
  if (method === 'POST' && path === '/api/routes') {
    const shaped = toJourneyRequest(await readJson(req));
    if ('problems' in shaped) return fail(400, 'INVALID_REQUEST', 'The request could not be read.', shaped.problems);
    const body = shaped.request;
    if (body.arriveBy !== undefined || body.stop) return fail(400, 'UNSUPPORTED_CONSTRAINT', 'Use /api/journey/plan for deadlines or stops.');
    const originId = typeof body.origin === 'string' ? geocode(body.origin).match?.place.id : undefined;
    const destId = typeof body.destination === 'string' ? geocode(body.destination).match?.place.id : undefined;
    if (!originId || !destId) return fail(400, 'UNRESOLVED', 'Origin or destination could not be resolved.');

    const date = body.date;
    const departAt = typeof body.departAt === 'number' ? body.departAt : 17 * 60;
    const hour = (departAt / 60) % 24;
    const dayType = dayTypeOf(date);
    const limit = typeof body.alternatives === 'number' ? Math.max(1, Math.min(8, body.alternatives)) : 4;

    const routes = routeOptions(originId, destId, hour, dayType, limit);
    if (!routes.length) return fail(404, 'NO_ROUTE', 'No route exists between those places.');

    return ok({
      origin: originId,
      destination: destId,
      dayType,
      departAt,
      routes: routes.map((r) => ({
        path: r.path,
        km: r.km,
        minutes: r.minutes,
        freeFlowMinutes: r.freeFlowMinutes,
        delayMinutes: r.delayMinutes,
        provenance: r.provenance,
        legs: r.legs,
      })),
    });
  }

  /* --- the main event --- */
  if (method === 'POST' && (path === '/api/journey/plan' || path === '/api/journey/optimize')) {
    const body = (await readJson(req)) as RawJourneyBody;
    const shaped = toJourneyRequest(body);
    if ('problems' in shaped) {
      return fail(400, 'INVALID_REQUEST', 'The request could not be read.', shaped.problems);
    }
    // /optimize is /plan with a deadline; refuse it without one rather than
    // silently answering a different question.
    if (path === '/api/journey/optimize' && shaped.request.arriveBy === undefined) {
      return fail(400, 'MISSING_DEADLINE', 'This endpoint needs an arriveBy time. Use /api/journey/plan otherwise.');
    }

    const plan = await planJourney(shaped.request);

    // Weather is context beside the plan, never an input to it.
    const forecastAt = new Date(plan.date + 'T00:00:00');
    forecastAt.setMinutes(plan.departAt);
    const observation = await weather.forecast(
      { lat: plan.origin.lat, lon: plan.origin.lon },
      forecastAt,
    );

    return ok({
      ...plan,
      weather: observation,
      weatherNote: weatherNote(observation),
    });
  }

  if (method === 'POST' && path === '/api/journey/parse') {
    const body = (await readJson(req)) as { text?: unknown };
    if (typeof body.text !== 'string') return fail(400, 'MISSING_TEXT', 'Pass { "text": "..." }.');
    const parsed = parseJourneyText(body.text, new Date());
    return ok(parsed);
  }

  /* --- traffic --- */
  if (method === 'GET' && path === '/api/traffic/forecast') {
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (!from || !to) return fail(400, 'MISSING_ENDS', 'Pass ?from= and ?to=.');
    const originId = geocode(from).match?.place.id;
    const destId = geocode(to).match?.place.id;
    if (!originId || !destId) return fail(400, 'UNRESOLVED', 'Origin or destination could not be resolved.');

    const dayType = dayTypeOf(dateFrom(url.searchParams.get('date')));
    const curve = departureCurve(originId, destId, 0, 23, dayType);
    const sample = fastestRoute(originId, destId, 8, dayType);

    return ok({
      origin: originId,
      destination: destId,
      dayType,
      basis: sample?.provenance.weakestTier ?? 'baseline',
      note: hasProfileData()
        ? 'Mixed collected and modeled journey times.'
        : 'Modeled. No journey times have been collected for this network yet.',
      hourly: curve,
    });
  }

  if (method === 'GET' && path.startsWith('/api/traffic/segment/')) {
    const id = decodeURIComponent(path.slice('/api/traffic/segment/'.length));
    const [a, b] = id.split('|');
    const road = ROADS.find(
      (r) => (r.a === a && r.b === b) || (r.a === b && r.b === a),
    );
    if (!road) {
      return fail(404, 'NO_SUCH_SEGMENT',
        'No such road. Segment ids look like "gulshan|badda"; see /api/system/status for the network size.');
    }
    const dayType = dayTypeOf(dateFrom(url.searchParams.get('date')));
    const hourly = [];
    for (let h = 0; h < 24; h++) {
      const estimate = estimateLeg(road, h, dayType);
      hourly.push({
        hour: h,
        minutes: Number(estimate.minutes.toFixed(2)),
        kmh: Number(estimate.kmh.toFixed(1)),
        tier: estimate.tier,
        tierLabel: TIER_LABEL[estimate.tier],
        samples: estimate.samples,
      });
    }
    return ok({
      segment: `${road.a}|${road.b}`,
      via: road.via ?? null,
      km: road.km,
      freeFlowKmh: road.freeKmh,
      dayType,
      hourly,
    });
  }

  /* --- weather --- */
  if (method === 'GET' && path === '/api/weather') {
    const lat = coordinate(url.searchParams.get('lat') ?? '23.78', 90);
    const lon = coordinate(url.searchParams.get('lon') ?? '90.41', 180);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fail(400, 'BAD_POINT', 'Invalid latitude or longitude.');
    const when = url.searchParams.get('at');
    const at = when ? new Date(when) : new Date();
    if (Number.isNaN(at.getTime())) return fail(400, 'BAD_TIME', 'Pass ?at= as an ISO timestamp.');

    const observation = await weather.forecast({ lat, lon }, at);
    if (!observation) {
      return fail(503, 'WEATHER_UNAVAILABLE', 'No forecast could be retrieved for that place and time.');
    }
    return ok({ ...observation, appliedToTravelTimes: false, note: weatherNote(observation) });
  }

  return fail(404, 'NOT_FOUND', `No endpoint at ${path}.`);
}

/* ---------- the server ---------- */

export const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const started = process.hrtime.bigint();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';

  // The page is served from a different origin in development.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  handle(method, url, req)
    .catch((error: unknown) => {
      if (error instanceof JourneyError) {
        const status = error.code === 'NO_ROUTE' || error.code === 'DEADLINE_UNREACHABLE' ? 404 : 400;
        return fail(status, error.code, error.message, error.detail);
      }
      if (error instanceof Error && error.message === 'INVALID_BODY') return fail(400, 'INVALID_REQUEST', 'Request body must be a JSON object.');
      if (error instanceof SyntaxError) {
        return fail(400, 'BAD_JSON', 'The request body was not valid JSON.');
      }
      if (error instanceof Error && error.message === 'TOO_LARGE') {
        return fail(413, 'TOO_LARGE', 'That request body is larger than this API accepts.');
      }
      // Log the detail; return none of it.
      console.error(`[error] ${method} ${url.pathname}`, error);
      return fail(500, 'INTERNAL', 'Something went wrong handling that request.');
    })
    .then(({ status, body }) => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
      });
      res.end(payload);

      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      // Structured enough to grep or ship, with no user text in it.
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        method,
        path: url.pathname,
        status,
        ms: Number(ms.toFixed(1)),
      }));
    });
});

export function startServer(): void {
server.listen(PORT, () => {
  console.log(`Journey API on http://localhost:${PORT}`);
  console.log(`  GET  /api/health`);
  console.log(`  GET  /api/system/status`);
  console.log(`  GET  /api/geocode?q=gulshan`);
  console.log(`  GET  /api/places/search?lat=23.78&lon=90.41&radiusKm=1&kind=restaurant`);
  console.log(`  POST /api/routes`);
  console.log(`  POST /api/journey/plan`);
  console.log(`  POST /api/journey/optimize`);
  console.log(`  POST /api/journey/parse`);
  console.log(`  GET  /api/traffic/forecast?from=gulshan&to=mirpur`);
  console.log(`  GET  /api/traffic/segment/gulshan|badda`);
  console.log(`  GET  /api/weather?lat=23.78&lon=90.41`);
  console.log(`\nStops search within ${STOP_SEARCH.maxOffsetKm} km of a route.`);
});

}
