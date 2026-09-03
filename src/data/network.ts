/**
 * THE ROUTABLE NETWORK — places and the roads between them.
 *
 * Deliberately separate from NODES/LINKS in traffic.ts. That graph is an
 * editorial diagram of the city's spine, drawn to be read at a glance; this one
 * has to be routable, which means enough places that a reader finds the one
 * they mean, and enough links that the paths between them are real.
 *
 * ⚠ PROVENANCE. The place names, the connections between them, and the
 * approximate distances are real. The SPEEDS ARE MODELED — assigned to match
 * the ordering these roads are reported to have, not measured. Until
 * scripts/collect-link-times.mjs has run, every duration this network produces
 * is an estimate built on those modeled speeds, and the trip planner says so
 * on screen. The collector replaces `peakKmh`/`freeKmh` wholesale.
 */

export interface Place {
  id: string;
  /** Display name. */
  name: string;
  /** Unit coordinates for the schematic: x west to east, y north to south. */
  x: number;
  y: number;
  /**
   * Real coordinates, used only by the collector when it asks a routing API how
   * long this trip takes. ⚠ Placed by hand and NOT verified against a map —
   * check every pair before spending on a collection run, because four weeks of
   * samples against the wrong junction is four weeks wasted.
   */
  lat: number;
  lon: number;
}

export interface Road {
  a: string;
  b: string;
  /** Approximate road distance in kilometers. */
  km: number;
  /** ⚠ MODELED speed at the worst hour, km/h. */
  peakKmh: number;
  /** ⚠ MODELED speed on a clear road, km/h. */
  freeKmh: number;
  /** The road's common name, shown in directions. */
  via?: string;
}

export const PLACES: readonly Place[] = [
  { id: 'uttara', name: 'Uttara', x: 0.54, y: 0.03, lat: 23.8759, lon: 90.3795 },
  { id: 'airport', name: 'Airport', x: 0.57, y: 0.10, lat: 23.8513, lon: 90.4085 },
  { id: 'khilkhet', name: 'Khilkhet', x: 0.62, y: 0.16, lat: 23.8290, lon: 90.4210 },
  { id: 'mirpur10', name: 'Mirpur 10', x: 0.20, y: 0.18, lat: 23.8069, lon: 90.3687 },
  { id: 'kuril', name: 'Kuril', x: 0.66, y: 0.21, lat: 23.8223, lon: 90.4265 },
  { id: 'bashundhara', name: 'Bashundhara R/A', x: 0.76, y: 0.20, lat: 23.8150, lon: 90.4400 },
  { id: 'kazipara', name: 'Kazipara', x: 0.24, y: 0.25, lat: 23.7960, lon: 90.3720 },
  { id: 'banani', name: 'Banani', x: 0.58, y: 0.27, lat: 23.7936, lon: 90.4043 },
  { id: 'agargaon', name: 'Agargaon', x: 0.33, y: 0.31, lat: 23.7780, lon: 90.3790 },
  { id: 'gulshan', name: 'Gulshan', x: 0.66, y: 0.31, lat: 23.7806, lon: 90.4143 },
  { id: 'mohakhali', name: 'Mohakhali', x: 0.50, y: 0.31, lat: 23.7776, lon: 90.4048 },
  { id: 'badda', name: 'Badda', x: 0.73, y: 0.34, lat: 23.7806, lon: 90.4256 },
  { id: 'shyamoli', name: 'Shyamoli', x: 0.24, y: 0.37, lat: 23.7746, lon: 90.3663 },
  { id: 'tejgaon', name: 'Tejgaon', x: 0.49, y: 0.38, lat: 23.7639, lon: 90.3960 },
  { id: 'farmgate', name: 'Farmgate', x: 0.42, y: 0.41, lat: 23.7578, lon: 90.3899 },
  { id: 'mohammadpur', name: 'Mohammadpur', x: 0.17, y: 0.43, lat: 23.7650, lon: 90.3590 },
  { id: 'rampura', name: 'Rampura', x: 0.70, y: 0.45, lat: 23.7614, lon: 90.4200 },
  { id: 'dhanmondi', name: 'Dhanmondi', x: 0.26, y: 0.49, lat: 23.7465, lon: 90.3760 },
  { id: 'malibagh', name: 'Malibagh', x: 0.60, y: 0.51, lat: 23.7500, lon: 90.4130 },
  { id: 'shahbagh', name: 'Shahbagh', x: 0.44, y: 0.53, lat: 23.7381, lon: 90.3958 },
  { id: 'newmarket', name: 'New Market', x: 0.34, y: 0.55, lat: 23.7335, lon: 90.3840 },
  { id: 'khilgaon', name: 'Khilgaon', x: 0.67, y: 0.59, lat: 23.7500, lon: 90.4270 },
  { id: 'paltan', name: 'Paltan', x: 0.50, y: 0.59, lat: 23.7345, lon: 90.4130 },
  { id: 'azimpur', name: 'Azimpur', x: 0.34, y: 0.61, lat: 23.7280, lon: 90.3840 },
  { id: 'motijheel', name: 'Motijheel', x: 0.55, y: 0.65, lat: 23.7330, lon: 90.4172 },
  { id: 'sadarghat', name: 'Sadarghat', x: 0.46, y: 0.77, lat: 23.7060, lon: 90.4080 },
  { id: 'jatrabari', name: 'Jatrabari', x: 0.60, y: 0.76, lat: 23.7100, lon: 90.4340 },
  { id: 'postogola', name: 'Postogola', x: 0.51, y: 0.85, lat: 23.6970, lon: 90.4300 },
];

export const ROADS: readonly Road[] = [
  { a: 'uttara', b: 'airport', km: 4.5, peakKmh: 14, freeKmh: 48, via: 'Airport Road' },
  { a: 'airport', b: 'khilkhet', km: 3.0, peakKmh: 12, freeKmh: 45, via: 'Airport Road' },
  { a: 'airport', b: 'mirpur10', km: 8.5, peakKmh: 9, freeKmh: 34, via: 'Kalshi and ECB' },
  { a: 'khilkhet', b: 'kuril', km: 2.4, peakKmh: 10, freeKmh: 40, via: 'Airport Road' },
  { a: 'kuril', b: 'bashundhara', km: 3.2, peakKmh: 12, freeKmh: 38, via: 'Kuril flyover' },
  { a: 'kuril', b: 'banani', km: 4.6, peakKmh: 9, freeKmh: 40, via: 'Airport Road' },
  { a: 'kuril', b: 'badda', km: 5.0, peakKmh: 6, freeKmh: 34, via: 'Progoti Sharani' },
  { a: 'mirpur10', b: 'kazipara', km: 2.2, peakKmh: 10, freeKmh: 32, via: 'Mirpur Road' },
  { a: 'kazipara', b: 'agargaon', km: 2.6, peakKmh: 11, freeKmh: 34, via: 'Rokeya Sarani' },
  { a: 'mirpur10', b: 'shyamoli', km: 4.4, peakKmh: 8, freeKmh: 32, via: 'Mirpur Road' },
  { a: 'banani', b: 'gulshan', km: 2.6, peakKmh: 7, freeKmh: 30, via: 'Kemal Ataturk Avenue' },
  { a: 'banani', b: 'mohakhali', km: 2.2, peakKmh: 5, freeKmh: 28, via: 'Airport Road' },
  { a: 'gulshan', b: 'badda', km: 3.4, peakKmh: 6, freeKmh: 28, via: 'Gulshan–Badda Link Road' },
  { a: 'gulshan', b: 'mohakhali', km: 3.0, peakKmh: 6, freeKmh: 30, via: 'Gulshan Avenue' },
  { a: 'badda', b: 'rampura', km: 3.6, peakKmh: 6, freeKmh: 30, via: 'Progoti Sharani' },
  { a: 'mohakhali', b: 'tejgaon', km: 2.4, peakKmh: 5, freeKmh: 28, via: 'Bijoy Sarani' },
  { a: 'agargaon', b: 'tejgaon', km: 3.0, peakKmh: 10, freeKmh: 34, via: 'Bijoy Sarani' },
  { a: 'agargaon', b: 'shyamoli', km: 2.8, peakKmh: 10, freeKmh: 32, via: 'Ring Road' },
  { a: 'tejgaon', b: 'farmgate', km: 1.8, peakKmh: 5, freeKmh: 26, via: 'Tejgaon Link Road' },
  { a: 'mohakhali', b: 'farmgate', km: 3.4, peakKmh: 4, freeKmh: 26, via: 'Bijoy Sarani' },
  { a: 'shyamoli', b: 'mohammadpur', km: 2.6, peakKmh: 9, freeKmh: 30, via: 'Ring Road' },
  { a: 'shyamoli', b: 'dhanmondi', km: 3.4, peakKmh: 8, freeKmh: 30, via: 'Mirpur Road' },
  { a: 'mohammadpur', b: 'dhanmondi', km: 3.0, peakKmh: 8, freeKmh: 28, via: 'Satmasjid Road' },
  { a: 'farmgate', b: 'shahbagh', km: 3.2, peakKmh: 5, freeKmh: 26, via: 'Kazi Nazrul Islam Avenue' },
  { a: 'farmgate', b: 'dhanmondi', km: 3.6, peakKmh: 7, freeKmh: 28, via: 'Green Road' },
  { a: 'dhanmondi', b: 'newmarket', km: 2.4, peakKmh: 7, freeKmh: 26, via: 'Mirpur Road' },
  { a: 'newmarket', b: 'shahbagh', km: 1.6, peakKmh: 6, freeKmh: 24, via: 'Nilkhet' },
  { a: 'newmarket', b: 'azimpur', km: 1.4, peakKmh: 7, freeKmh: 24, via: 'Azimpur Road' },
  { a: 'rampura', b: 'malibagh', km: 3.0, peakKmh: 5, freeKmh: 26, via: 'Rampura Road' },
  { a: 'malibagh', b: 'khilgaon', km: 2.4, peakKmh: 7, freeKmh: 28, via: 'Khilgaon flyover' },
  { a: 'malibagh', b: 'paltan', km: 3.2, peakKmh: 5, freeKmh: 24, via: 'Kakrail' },
  { a: 'shahbagh', b: 'paltan', km: 2.2, peakKmh: 6, freeKmh: 26, via: 'Kakrail' },
  { a: 'paltan', b: 'motijheel', km: 1.8, peakKmh: 6, freeKmh: 24, via: 'Dilkusha' },
  { a: 'azimpur', b: 'sadarghat', km: 4.2, peakKmh: 6, freeKmh: 24, via: 'Old Dhaka' },
  { a: 'motijheel', b: 'sadarghat', km: 3.4, peakKmh: 6, freeKmh: 24, via: 'Toyenbee Road' },
  { a: 'motijheel', b: 'jatrabari', km: 5.0, peakKmh: 7, freeKmh: 30, via: 'Gulistan' },
  { a: 'khilgaon', b: 'jatrabari', km: 4.4, peakKmh: 8, freeKmh: 30, via: 'Rajarbagh' },
  { a: 'jatrabari', b: 'postogola', km: 3.6, peakKmh: 9, freeKmh: 32, via: 'Dholaipar' },
  { a: 'sadarghat', b: 'postogola', km: 3.0, peakKmh: 7, freeKmh: 26, via: 'Buriganga bank' },
];

/**
 * ⚠ MODELED. How much of the working week's congestion survives on a Friday or
 * Saturday, hour by hour. Dhaka's weekend has no commuting peaks, so the
 * morning and evening troughs largely fill in; the midday shopping and visiting
 * traffic does not disappear.
 *
 * 1.0 would mean a weekend hour is exactly as slow as the same working hour.
 */
export const WEEKEND_RELIEF: readonly number[] = [
  1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 0.95, 0.80, 0.62, 0.58, 0.62, 0.72,
  0.78, 0.80, 0.80, 0.82, 0.84, 0.80, 0.74, 0.72, 0.76, 0.86, 0.95, 1.00,
];

/** Friday and Saturday. */
export const WEEKEND_DAYS: ReadonlySet<number> = new Set([5, 6]);

/** The windows a reader picks from, rather than a bare hour. */
export const TIME_WINDOWS: readonly { id: string; label: string; from: number; to: number }[] = [
  { id: 'morning', label: 'Morning', from: 7, to: 11 },
  { id: 'midday', label: 'Midday', from: 11, to: 15 },
  { id: 'evening', label: 'Evening', from: 16, to: 21 },
  { id: 'night', label: 'Late night', from: 21, to: 24 },
];
