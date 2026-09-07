/* =====================================================================
   WEATHER — reported, deliberately not applied

   Weather is fetched from Open-Meteo, which is free, keyless and openly
   licensed. It is shown to the traveller as context.

   IT DOES NOT CHANGE A SINGLE TRAVEL TIME, and that is the important part.

   Everyone knows Dhaka floods and everyone knows the roads seize when it does.
   The question a model has to answer is not "does rain slow traffic" but "by
   how much, on this road, at this hour" — and answering it requires journey
   times measured in the rain and compared against journey times measured dry.
   No such series exists here yet. Picking a multiplier would be inventing the
   finding rather than measuring it, and it would be invisible: every estimate
   would silently shift by a number nobody could check.

   So the provider reports, the planner displays, and the arithmetic is
   untouched. When the collection programme has run through a monsoon, the
   effect can be fitted from the data and this comment can be replaced with a
   coefficient and the evidence for it.
   ===================================================================== */
import type { LatLon } from '../geo';

export interface WeatherObservation {
  /** ISO timestamp the reading applies to. */
  time: string;
  temperatureC: number | null;
  /** Millimetres in the hour. */
  precipitationMm: number | null;
  /** 0-100. */
  precipitationChance: number | null;
  /** Open-Meteo WMO weather code, when given. */
  code: number | null;
  description: string;
  source: string;
  attribution: string;
}

export interface WeatherProvider {
  readonly id: string;
  /** Null whenever the reading is unavailable, for any reason. */
  forecast(at: LatLon, when: Date): Promise<WeatherObservation | null>;
}

/** WMO codes, condensed to what a traveller cares about. */
function describe(code: number | null): string {
  if (code === null) return 'unknown';
  if (code === 0) return 'clear';
  if (code <= 3) return 'partly cloudy';
  if (code <= 48) return 'fog';
  if (code <= 57) return 'drizzle';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'rain showers';
  if (code <= 99) return 'thunderstorm';
  return 'unknown';
}

/**
 * Open-Meteo. No key, no account, and its terms permit this use.
 *
 * Returns null on any failure rather than throwing: a journey plan is still
 * worth having without a weather line, and the planner says the line is
 * missing rather than leaving a gap the reader has to interpret.
 */
export function openMeteo(fetchImpl: typeof fetch = fetch): WeatherProvider {
  return {
    id: 'open-meteo',

    async forecast(at: LatLon, when: Date): Promise<WeatherObservation | null> {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', at.lat.toFixed(4));
      url.searchParams.set('longitude', at.lon.toFixed(4));
      url.searchParams.set('hourly', 'temperature_2m,precipitation,precipitation_probability,weather_code');
      url.searchParams.set('timezone', 'Asia/Dhaka');
      url.searchParams.set('forecast_days', '7');

      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) return null;

        const body = (await response.json()) as {
          hourly?: {
            time?: string[];
            temperature_2m?: (number | null)[];
            precipitation?: (number | null)[];
            precipitation_probability?: (number | null)[];
            weather_code?: (number | null)[];
          };
        };

        const times = body.hourly?.time;
        if (!times?.length) return null;

        // Open-Meteo returns local hours; match the closest one to the journey.
        const target = when.getTime();
        let index = 0;
        let bestGap = Infinity;
        for (let i = 0; i < times.length; i++) {
          const gap = Math.abs(new Date(times[i]!).getTime() - target);
          if (gap < bestGap) {
            bestGap = gap;
            index = i;
          }
        }
        // more than three hours away is not a forecast for this journey
        if (bestGap > 3 * 3_600_000) return null;

        const code = body.hourly?.weather_code?.[index] ?? null;
        return {
          time: times[index]!,
          temperatureC: body.hourly?.temperature_2m?.[index] ?? null,
          precipitationMm: body.hourly?.precipitation?.[index] ?? null,
          precipitationChance: body.hourly?.precipitation_probability?.[index] ?? null,
          code,
          description: describe(code),
          source: 'Open-Meteo',
          attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
        };
      } catch {
        return null;
      }
    },
  };
}

/** For tests, and for any deployment that should not make outbound calls. */
export const noWeather: WeatherProvider = {
  id: 'none',
  async forecast(): Promise<WeatherObservation | null> {
    return null;
  },
};

/**
 * The sentence shown beside a plan.
 *
 * Says what the weather is AND that it was not applied, because a forecast
 * printed next to a travel time will otherwise be assumed to be baked into it.
 */
export function weatherNote(observation: WeatherObservation | null): string {
  if (!observation) {
    return 'Weather was unavailable, and is not included in these estimates either way.';
  }
  const bits: string[] = [observation.description];
  if (observation.temperatureC !== null) bits.push(`${Math.round(observation.temperatureC)}°C`);
  if (observation.precipitationMm !== null && observation.precipitationMm > 0) {
    bits.push(`${observation.precipitationMm.toFixed(1)} mm of rain`);
  } else if (observation.precipitationChance !== null) {
    bits.push(`${observation.precipitationChance}% chance of rain`);
  }
  return `Forecast at that hour: ${bits.join(', ')}. `
    + 'Travel times here do not adjust for weather — no measured rain-versus-dry '
    + 'series exists yet to say by how much they should.';
}
