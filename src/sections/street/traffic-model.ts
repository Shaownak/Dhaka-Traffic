/* =====================================================================
   THE MODEL — a car-following simulation, and nothing else.

   No Three imports live in this file, on purpose. It takes a lane
   configuration and returns positions; the scene decides what a position
   looks like. That separation is what makes the model testable.

   Every vehicle picks its speed from the gap in front of it, clamped by how
   hard it can accelerate and brake, plus an occasional spontaneous brake tap.
   The queues and the stop-start waves are emergent. If a change makes the
   traffic look smoother, the change is wrong.
   ===================================================================== */
import { CORRIDORS, HOURLY_SPEED_KMH } from '../../data/traffic';

/** Meters of road simulated. The road wraps: it is a ring, drawn straight. */
export const ROAD_LENGTH = 260;

/** Hard ceiling on drawn vehicles, so the instanced meshes can be sized once. */
export const MAX_VEHICLES = 300;

/** Lane centers, meters from the median. Mirrored for the opposing roadway. */
export const LANE_OFFSETS: readonly number[] = [2.4, 6.0, 9.6];

/** Car-following constants, in meters, seconds, and m/s². */
export const MODEL = {
  /** Desired time headway to the vehicle ahead. */
  headway: 1.15,
  /** Space kept even at a standstill. */
  minGap: 1.8,
  accel: 1.9,
  brake: 5.5,
  /** Chance per vehicle per step of a driver braking for no reason at all. */
  tapChance: 0.012,
  /** How much of the intended speed survives that tap. */
  tapFactor: 0.45,
} as const;

export type VehicleTypeName = 'car' | 'rickshaw' | 'cng' | 'leguna' | 'bus' | 'truck' | 'motorcycle';

export interface VehicleKind {
  type: VehicleTypeName;
  /** Meters. */
  len: number;
  w: number;
  h: number;
  /** Cabin length as a fraction of the body. */
  cab: number;
  /** Share of the fleet (summing to 1.0). */
  p: number;
}

export const KINDS: readonly VehicleKind[] = [
  { type: 'car', len: 4.4, w: 1.9, h: 1.5, cab: 0.55, p: 0.30 },
  { type: 'rickshaw', len: 3.0, w: 1.5, h: 1.8, cab: 0.75, p: 0.18 },
  { type: 'cng', len: 3.2, w: 1.6, h: 1.7, cab: 0.70, p: 0.14 },
  { type: 'leguna', len: 4.2, w: 1.8, h: 2.1, cab: 0.45, p: 0.10 },
  { type: 'bus', len: 11.5, w: 2.6, h: 3.1, cab: 0.85, p: 0.12 },
  { type: 'truck', len: 7.5, w: 2.4, h: 2.8, cab: 0.40, p: 0.06 },
  { type: 'motorcycle', len: 2.1, w: 0.85, h: 1.2, cab: 0.40, p: 0.10 },
];

export interface Vehicle {
  /** Distance traveled along the ring, meters. */
  s: number;
  /** Current speed, m/s. */
  v: number;
  /** The speed this driver would hold on an empty road, m/s. */
  vmax: number;
  kind: VehicleKind;
  /** Index into whatever palette the renderer uses. The model has no colors. */
  color: number;
}

export interface Lane {
  /** 1 runs left to right, -1 runs the other way. */
  dir: 1 | -1;
  /** Signed lane center, meters. */
  z: number;
  cars: Vehicle[];
}

/** A placed vehicle, in scene coordinates, ready to be drawn. */
export interface Placement {
  x: number;
  z: number;
  dir: 1 | -1;
  kind: VehicleKind;
  color: number;
  v: number;
}

export interface ModelOptions {
  roadLength?: number;
  laneOffsets?: readonly number[];
  /** Injectable for tests; defaults to Math.random. */
  rng?: () => number;
  /** How many distinct body colors the renderer offers. */
  palette?: number;
}

/**
 * How fast a corridor runs at a given hour.
 *
 * The city-wide hourly curve sets the shape; the corridor's own free-flow and
 * peak speeds set the range. `t` is 0 at the worst hour of the day and 1 at
 * the best, and the scene uses it for density as well as speed.
 */
export function corridorConditions(
  corridor: number,
  hour: number,
  isRain = false,
): { kmh: number; t: number } {
  const c = CORRIDORS[corridor] ?? CORRIDORS[0]!;
  const day = HOURLY_SPEED_KMH[hour | 0] ?? HOURLY_SPEED_KMH[0]!;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of HOURLY_SPEED_KMH) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  let t = hi === lo ? 0 : (day - lo) / (hi - lo);
  let kmh = c.peak + (c.free - c.peak) * t;

  if (isRain) {
    // Monsoon waterlogging severely degrades surface street throughput
    kmh = Math.max(3.2, kmh * 0.55);
    t = Math.max(0, t * 0.4);
  }

  return { kmh, t };
}

/** Mean vehicle length, weighted by how common each kind is. */
export const AVERAGE_VEHICLE_LENGTH = KINDS.reduce((sum, k) => sum + k.len * k.p, 0);

/**
 * Meters of road per vehicle for a road running at `kmh`.
 *
 * Derived from the car-following rule rather than from the clock. A vehicle
 * holding speed v wants a gap of `v * headway + minGap`, so the road that
 * sustains v has that gap plus one vehicle length between centres.
 *
 * This used to be a function of the hour alone, which meant every corridor was
 * packed to the same density at the same time of day. The gap then capped
 * every vehicle at the same crawl no matter which road was selected — so the
 * readout could claim 14 km/h while the traffic moved at 5, and switching
 * corridors changed nothing you could see. Density and speed are two views of
 * the same thing; deriving one from the other is what makes them agree.
 */
export function spacingFor(kmh: number): number {
  const v = Math.max(0, kmh) / 3.6;
  return v * MODEL.headway + MODEL.minGap + AVERAGE_VEHICLE_LENGTH;
}

export class TrafficModel {
  readonly lanes: Lane[] = [];
  readonly roadLength: number;
  private readonly rng: () => number;
  private readonly palette: number;
  private isRain = false;

  constructor(options: ModelOptions = {}) {
    this.roadLength = options.roadLength ?? ROAD_LENGTH;
    this.rng = options.rng ?? Math.random;
    this.palette = options.palette ?? 12;
    const offsets = options.laneOffsets ?? LANE_OFFSETS;
    for (const dir of [1, -1] as const) {
      for (const z of offsets) this.lanes.push({ dir, z: dir * z, cars: [] });
    }
  }

  setRain(rain: boolean): void {
    this.isRain = rain;
  }

  get rain(): boolean {
    return this.isRain;
  }

  private pickKind(): VehicleKind {
    const r = this.rng();
    let acc = 0;
    for (const k of KINDS) {
      acc += k.p;
      if (r <= acc) return k;
    }
    return KINDS[0]!;
  }

  /**
   * Refill every lane for a given speed. Slower traffic is packed tighter,
   * which is what makes the peak-hour road look full before it even moves.
   */
  populate(kmh: number, spacing: number): void {
    const effectiveSpacing = this.isRain ? Math.max(5.5, spacing * 0.75) : spacing;
    const perLane = Math.max(3, Math.min(36, Math.round(this.roadLength / effectiveSpacing)));
    const v = kmh / 3.6;
    for (const lane of this.lanes) {
      lane.cars = [];
      let s = this.rng() * 8;
      for (let i = 0; i < perLane; i++) {
        lane.cars.push({
          s: s % this.roadLength,
          v,
          vmax: v * (0.86 + this.rng() * 0.3),
          kind: this.pickKind(),
          color: (this.rng() * this.palette) | 0,
        });
        s += this.roadLength / perLane;
      }
    }
  }

  /** Advance the simulation by `dt` seconds. */
  step(dt: number): void {
    const { headway, minGap, accel, brake, tapChance, tapFactor } = MODEL;
    const activeTapChance = this.isRain ? tapChance * 1.8 : tapChance;

    for (const lane of this.lanes) {
      const cars = lane.cars;
      const n = cars.length;
      for (let i = 0; i < n; i++) {
        const c = cars[i]!;
        const lead = cars[(i + 1) % n]!;
        let gap = lead.s - c.s - lead.kind.len;
        if (gap < 0) gap += this.roadLength;
        let want = Math.min(c.vmax, Math.max(0, (gap - minGap) / headway));
        if (this.rng() < activeTapChance) want *= tapFactor; // the phantom brake tap
        const dv = want - c.v;
        c.v += Math.max(-brake * dt, Math.min(accel * dt, dv));
        if (c.v < 0) c.v = 0;
        c.s = (c.s + c.v * dt) % this.roadLength;
      }
    }
  }

  get vehicleCount(): number {
    let n = 0;
    for (const lane of this.lanes) n += lane.cars.length;
    return n;
  }

  /** Mean speed across the fleet, m/s. Useful in tests and readouts. */
  get meanSpeed(): number {
    let sum = 0;
    let n = 0;
    for (const lane of this.lanes) {
      for (const c of lane.cars) {
        sum += c.v;
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  /**
   * Where every vehicle is, in scene coordinates, centered on the road.
   * Capped at `limit` so the renderer never overruns its instance buffers.
   */
  *placements(limit = MAX_VEHICLES): Generator<Placement> {
    let n = 0;
    const half = this.roadLength / 2;
    for (const lane of this.lanes) {
      for (const c of lane.cars) {
        if (n >= limit) return;
        yield {
          x: lane.dir > 0 ? c.s - half : half - c.s,
          z: lane.z,
          dir: lane.dir,
          kind: c.kind,
          color: c.color,
          v: c.v,
        };
        n++;
      }
    }
  }
}
