/* =====================================================================
   1. THE JAM — lanes of vehicles crawling across the cover
   A 2D canvas: scenic visual representation of Dhaka traffic.
   ===================================================================== */
import { REDUCED, onReducedMotionChange } from '../util';

interface VehicleStyle {
  type?: string;
  len: number;
  h: number;
  body: string;
  trim: string;
}

interface Car {
  x: number;
  v: VehicleStyle;
  len: number;
}

interface Lane {
  y: number;
  /** Pixels per second, signed. */
  speed: number;
  dir: 1 | -1;
  cars: Car[];
}

const NEUTRAL: readonly VehicleStyle[] = [
  { len: 78, h: 32, body: '#EFE6D6', trim: '#4A3A34' }, // white car
  { len: 74, h: 31, body: '#C6BEAF', trim: '#4A3A34' }, // silver car
  { len: 72, h: 30, body: '#8E9490', trim: '#EDE5D7' },
  { len: 80, h: 33, body: '#3E4A47', trim: '#A8B0AB' },
  { len: 142, h: 41, body: '#D8CFBE', trim: '#7A2A3A' }, // bus
  { len: 120, h: 38, body: '#7C6A5A', trim: '#E0D5C2' }, // truck
  { type: 'motorcycle', len: 38, h: 18, body: '#2A1712', trim: '#C42348' }, // motorcycle
];

const ACCENT: readonly VehicleStyle[] = [
  { len: 52, h: 36, body: '#C42348', trim: '#F2A310' }, // rickshaw
  { len: 52, h: 36, body: '#E8548C', trim: '#F6EEE0' },
  { len: 50, h: 34, body: '#3FA88A', trim: '#F6EEE0' }, // CNG auto-rickshaw
  { len: 50, h: 34, body: '#4FB3C4', trim: '#F6EEE0' },
  { len: 138, h: 41, body: '#F2A310', trim: '#C42348' }, // painted bus
  { len: 74, h: 31, body: '#7FBF4A', trim: '#2A1712' },
  { type: 'leguna', len: 68, h: 34, body: '#0D6A6C', trim: '#F2A310' }, // Leguna human-hauler
];

function pickVehicle(): VehicleStyle {
  const pool = Math.random() < 0.62 ? NEUTRAL : ACCENT;
  return pool[(Math.random() * pool.length) | 0]!;
}

export class Jam {
  private readonly ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  /** Vehicle scale: shrinks on mobile devices. */
  private k = 1;
  private laneH = 0;
  private lanes: Lane[] = [];
  private raf: number | null = null;

  constructor(private readonly cv: HTMLCanvasElement) {
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.resize();

    onReducedMotionChange((reduced) => {
      if (reduced) {
        this.stop();
        this.draw(0);
      } else {
        this.start();
      }
    });
  }

  resize(): void {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.cv.width = Math.max(1, r.width * dpr);
    this.cv.height = Math.max(1, r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.k = this.w < 700 ? 0.62 : 1;
    this.build();
  }

  private build(): void {
    this.laneH = 52 * this.k + 26;
    const n = Math.max(4, Math.ceil(this.h / this.laneH) + 1);
    this.lanes = [];
    for (let i = 0; i < n; i++) {
      const y = i * this.laneH + this.laneH / 2;
      const dir: 1 | -1 = i % 2 ? 1 : -1;
      const speed = (6 + Math.random() * 7) * dir; // px per second
      const cars: Car[] = [];
      let x = -300 + Math.random() * 200;
      while (x < this.w + 340) {
        const v = pickVehicle();
        const len = v.len * this.k;
        cars.push({ x, v, len });
        x += len + 7 * this.k + (Math.random() < 0.1 ? (42 + Math.random() * 90) * this.k : Math.random() * 8);
      }
      this.lanes.push({ y, speed, dir, cars });
    }
  }

  private vehicle(c: CanvasRenderingContext2D, x: number, y: number, len: number, h: number, v: VehicleStyle, dir: number): void {
    const r = h * 0.3;

    c.fillStyle = v.body;
    this.rr(c, x, y - h / 2, len, h, r);
    c.fill();
    c.strokeStyle = 'rgba(24,8,14,.55)';
    c.lineWidth = 1.6;
    c.stroke();

    // wheels, tabs protruding past the body edge
    c.fillStyle = 'rgba(16,7,11,.85)';
    const ww = len * 0.14;
    const wh = h * 0.13;
    for (const ox of [len * 0.13, len * 0.71]) {
      this.rr(c, x + ox, y - h / 2 - wh * 0.62, ww, wh, wh * 0.35);
      c.fill();
      this.rr(c, x + ox, y + h / 2 - wh * 0.38, ww, wh, wh * 0.35);
      c.fill();
    }

    // roof panel down the middle
    c.fillStyle = v.trim;
    this.rr(c, x + len * 0.24, y - h * 0.21, len * 0.5, h * 0.42, r * 0.45);
    c.fill();

    // windshield at the leading edge
    c.globalAlpha = 0.6;
    c.fillStyle = '#F6EEE0';
    const wx = dir > 0 ? x + len * 0.79 : x + len * 0.1;
    this.rr(c, wx, y - h * 0.24, len * 0.11, h * 0.48, r * 0.35);
    c.fill();
    c.globalAlpha = 1;
  }

  private draw(dt: number): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);

    c.strokeStyle = 'rgba(255,236,220,0.06)';
    c.lineWidth = 1.5;
    c.setLineDash([18, 22]);
    for (let i = 1; i < this.lanes.length; i++) {
      const y = i * this.laneH;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(this.w, y);
      c.stroke();
    }
    c.setLineDash([]);

    for (const L of this.lanes) {
      for (const car of L.cars) {
        if (!REDUCED) car.x += (L.speed * dt) / 1000;
        if (car.x > this.w + 340) car.x = -340;
        if (car.x < -340) car.x = this.w + 340;
        this.vehicle(c, car.x, L.y, car.len, car.v.h * this.k, car.v, L.dir);
      }
    }
  }

  /** Rounded rectangle, path only. */
  private rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  start(): void {
    if (this.raf !== null) return;
    if (REDUCED) {
      this.draw(0);
      return;
    }
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = Math.min(now - last, 60);
      last = now;
      this.draw(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}
