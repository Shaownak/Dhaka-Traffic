/* =====================================================================
   THE STREET, IN THREE DIMENSIONS
   Geometry, lights, and the sky by hour. Everything that moves is decided in
   traffic-model.ts; this file only puts boxes where the model says.

   This module is the only one that imports Three, and it is loaded on demand
   by ./index.ts so the initial bundle never carries it.
   ===================================================================== */
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { CORRIDORS } from '../../data/traffic';
import { REDUCED } from '../../util';
import {
  MAX_VEHICLES,
  ROAD_LENGTH,
  TrafficModel,
  corridorConditions,
  spacingFor,
} from './traffic-model';

/** Vehicle bodies palette (Dhaka authentic tones). */
const BODY_COLORS: readonly number[] = [
  0xefe6d6, 0xefe6d6, 0xc6beaf, 0x8e9490, 0x3e4a47, 0x7c6a5a,
  0xc42348, 0xe8548c, 0x3fa88a, 0x4fb3c4, 0xf2a310, 0x7fbf4a,
];

interface SkyKey {
  h: number;
  sky: number;
  ground: number;
  sun: number;
  amb: number;
  key: number;
}

/** The day, keyed at the hours where the light actually turns. */
const SKIES: readonly SkyKey[] = [
  { h: 0, sky: 0x0b1622, ground: 0x1a1218, sun: 0x2e3a52, amb: 0.30, key: 0.20 },
  { h: 5, sky: 0x2a2338, ground: 0x2a1f22, sun: 0x8c6e86, amb: 0.42, key: 0.42 },
  { h: 7, sky: 0x8a6a62, ground: 0x4a3a34, sun: 0xffb877, amb: 0.62, key: 0.85 },
  { h: 11, sky: 0xb9bec0, ground: 0x6e645c, sun: 0xfff3e0, amb: 0.80, key: 1.05 },
  { h: 16, sky: 0xb08e72, ground: 0x6a544a, sun: 0xffce9a, amb: 0.72, key: 0.95 },
  { h: 18, sky: 0x7c4a46, ground: 0x3e2a2c, sun: 0xff9a6a, amb: 0.55, key: 0.66 },
  { h: 20, sky: 0x2a2136, ground: 0x241a20, sun: 0x6e5a78, amb: 0.38, key: 0.32 },
  { h: 24, sky: 0x0b1622, ground: 0x1a1218, sun: 0x2e3a52, amb: 0.30, key: 0.20 },
];

interface SkyState {
  sky: Color;
  ground: Color;
  sun: Color;
  amb: number;
  key: number;
}

function skyAt(h: number, isRain = false): SkyState {
  if (isRain) {
    // Overcast monsoon sky
    return {
      sky: new Color(0x1a242c),
      ground: new Color(0x181a1c),
      sun: new Color(0x405565),
      amb: 0.38,
      key: 0.32,
    };
  }

  let i = 0;
  while (i < SKIES.length - 2 && SKIES[i + 1]!.h <= h) i++;
  const a = SKIES[i]!;
  const b = SKIES[i + 1]!;
  const t = (h - a.h) / (b.h - a.h || 1);
  const mix = (x: number, y: number): Color => new Color(x).lerp(new Color(y), t);
  return {
    sky: mix(a.sky, b.sky),
    ground: mix(a.ground, b.ground),
    sun: mix(a.sun, b.sun),
    amb: a.amb + (b.amb - a.amb) * t,
    key: a.key + (b.key - a.key) * t,
  };
}

interface Building {
  x: number;
  z: number;
  w: number;
  h: number;
  dep: number;
}

export interface Readout {
  hour: number;
  corridor: string;
  kmh: number;
  isRain: boolean;
}

export type CameraPreset = 'orbit' | 'overpass' | 'driver';

export class StreetScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(42, 1, 1, 900);
  private readonly target = new Vector3(0, 2, 0);
  private readonly amb: HemisphereLight;
  private readonly key: DirectionalLight;

  private groundMat!: MeshLambertMaterial;
  private asphaltMat!: MeshLambertMaterial;
  private city!: Group;
  private windows!: InstancedMesh;
  private lamps!: Group;
  private bodies!: InstancedMesh;
  private cabins!: InstancedMesh;
  private accents!: InstancedMesh;
  private lights!: InstancedMesh;
  private rainMesh!: InstancedMesh;
  private rainPositions: Float32Array | null = null;
  private readonly dummy = new Object3D();
  private readonly tint = new Color();

  private hour = 18;
  private corridor = 0;
  private isRain = false;
  private cameraPreset: CameraPreset = 'orbit';

  private readonly baseTheta = -Math.PI / 2 + 0.1;
  private theta = this.baseTheta;
  private phi = 0.24;
  private radius = 84;
  private targetTheta = this.baseTheta;
  private targetPhi = 0.24;
  private targetRadius = 84;
  private targetOffsetY = 7;

  private t = 0;
  private userLooking = false;
  private raf: number | null = null;

  /** Called whenever the hour, the corridor or the road speed changes. */
  onReadout: ((r: Readout) => void) | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly model: TrafficModel,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    el.appendChild(this.renderer.domElement);

    this.amb = new HemisphereLight(0xffffff, 0x404040, 0.7);
    this.key = new DirectionalLight(0xffffff, 1);
    this.key.position.set(60, 90, 40);
    this.scene.add(this.amb, this.key);

    this.buildRoad();
    this.buildCity();
    this.buildFleet();
    this.buildLamps();
    this.buildRain();
    this.bindDrag();
    this.setHour(18, true);
    this.resize();
  }

  /* ---------- static geometry ---------- */

  private buildRoad(): void {
    const g = new Group();
    this.groundMat = new MeshLambertMaterial({ color: 0x6e645c });
    const ground = new Mesh(new PlaneGeometry(1800, 1800), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.62;
    g.add(ground);

    this.asphaltMat = new MeshLambertMaterial({ color: 0x2f2a2c });
    const road = new Mesh(new BoxGeometry(ROAD_LENGTH, 0.6, 24.4), this.asphaltMat);
    road.position.y = -0.3;
    g.add(road);

    const kerb = new MeshLambertMaterial({ color: 0x8c8078 });
    for (const z of [-12.8, 12.8]) {
      const m = new Mesh(new BoxGeometry(ROAD_LENGTH, 1.1, 1.2), kerb);
      m.position.set(0, 0.25, z);
      g.add(m);
    }
    const median = new Mesh(
      new BoxGeometry(ROAD_LENGTH, 1.0, 1.5),
      new MeshLambertMaterial({ color: 0x9a8e82 }),
    );
    median.position.y = 0.2;
    g.add(median);

    const dash = new MeshLambertMaterial({ color: 0xd8cfc0 });
    const marks = new InstancedMesh(new BoxGeometry(2.6, 0.06, 0.18), dash, 400);
    const d = this.dummy;
    let n = 0;
    for (const off of [4.2, 7.8]) {
      for (const sgn of [1, -1]) {
        for (let x = -ROAD_LENGTH / 2; x < ROAD_LENGTH / 2; x += 7) {
          d.position.set(x, 0.04, sgn * off);
          d.updateMatrix();
          marks.setMatrixAt(n++, d.matrix);
        }
      }
    }
    marks.count = n;
    g.add(marks);
    this.scene.add(g);
  }

  private buildCity(): void {
    const palette = [0xd8c6a8, 0xc4a98a, 0xa8907a, 0x8e7a68, 0xbfa98e, 0x9c8470];
    const g = new Group();
    const blocks: Building[] = [];
    for (const sgn of [1, -1]) {
      let x = -ROAD_LENGTH / 2;
      while (x < ROAD_LENGTH / 2) {
        const w = 8 + Math.random() * 16;
        const dep = 12 + Math.random() * 16;
        const h = 7 + Math.random() * Math.random() * 26;
        const m = new Mesh(
          new BoxGeometry(w, h, dep),
          new MeshLambertMaterial({ color: palette[(Math.random() * palette.length) | 0] }),
        );
        const z = sgn * (18.5 + dep / 2);
        m.position.set(x + w / 2, h / 2, z);
        g.add(m);
        blocks.push({ x: x + w / 2, z, w, h, dep });
        x += w + 1.5 + Math.random() * 4;
      }
    }
    this.city = g;
    this.scene.add(g);

    // lit windows for evening
    const win = new InstancedMesh(
      new BoxGeometry(1.5, 1.9, 0.3),
      new MeshBasicMaterial({ color: 0xffd68c }),
      900,
    );
    const d = this.dummy;
    let n = 0;
    for (const b of blocks) {
      const rows = Math.min(9, Math.floor(b.h / 6));
      const cols = Math.min(5, Math.floor(b.w / 4));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() > 0.55 || n >= 900) continue;
          const sgn = Math.sign(b.z);
          d.position.set(
            b.x - b.w / 2 + (c + 0.5) * (b.w / cols),
            3 + (r + 0.5) * (b.h / rows) * 0.92,
            b.z - sgn * (b.dep / 2 + 0.1),
          );
          d.updateMatrix();
          win.setMatrixAt(n++, d.matrix);
        }
      }
    }
    win.count = n;
    this.windows = win;
    this.scene.add(win);
  }

  private buildLamps(): void {
    const g = new Group();
    const pole = new MeshLambertMaterial({ color: 0x4a4440 });
    const glow = new MeshBasicMaterial({ color: 0xffc96b });
    for (let x = -ROAD_LENGTH / 2; x < ROAD_LENGTH / 2; x += 26) {
      for (const sgn of [1, -1]) {
        const p = new Mesh(new BoxGeometry(0.35, 9, 0.35), pole);
        p.position.set(x, 4.5, sgn * 13.4);
        g.add(p);
        const arm = new Mesh(new BoxGeometry(0.22, 0.22, 2.4), pole);
        arm.position.set(x, 8.9, sgn * 12.2);
        g.add(arm);
        const head = new Mesh(new BoxGeometry(0.9, 0.26, 0.5), glow);
        head.position.set(x, 8.72, sgn * 11.1);
        g.add(head);
      }
    }
    this.lamps = g;
    this.scene.add(g);
  }

  /** One instanced mesh per part of a vehicle, not one mesh per vehicle. */
  private buildFleet(): void {
    const box = new BoxGeometry(1, 1, 1);
    this.bodies = new InstancedMesh(box, new MeshLambertMaterial(), MAX_VEHICLES);
    this.cabins = new InstancedMesh(box, new MeshLambertMaterial({ color: 0x2a2226 }), MAX_VEHICLES);
    this.accents = new InstancedMesh(box, new MeshLambertMaterial({ color: 0xf2a310 }), MAX_VEHICLES);
    this.lights = new InstancedMesh(box, new MeshBasicMaterial({ color: 0xffe6b0 }), MAX_VEHICLES * 2);
    for (const m of [this.bodies, this.cabins, this.accents, this.lights]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      this.scene.add(m);
    }
  }

  private buildRain(): void {
    const count = 1200;
    const geom = new BoxGeometry(0.08, 1.8, 0.08);
    const mat = new MeshBasicMaterial({ color: 0x8ba6bc, transparent: true, opacity: 0.65 });
    this.rainMesh = new InstancedMesh(geom, mat, count);
    this.rainPositions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      this.rainPositions[i * 3] = (Math.random() - 0.5) * ROAD_LENGTH;
      this.rainPositions[i * 3 + 1] = Math.random() * 45;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 48;
    }
    this.rainMesh.visible = false;
    this.scene.add(this.rainMesh);
  }

  /* ---------- state ---------- */

  private conditions(): { kmh: number; t: number } {
    return corridorConditions(this.corridor, this.hour, this.isRain);
  }

  private repopulate(): void {
    const { kmh } = this.conditions();
    this.model.setRain(this.isRain);
    this.model.populate(kmh, spacingFor(kmh));
  }

  setHour(h: number, force = false): void {
    const changed = (h | 0) !== (this.hour | 0);
    this.hour = h;
    if (changed || force) this.repopulate();

    const sk = skyAt(h, this.isRain);
    this.scene.background = sk.sky;
    this.scene.fog = new Fog(sk.sky, this.isRain ? 70 : 130, this.isRain ? 280 : 470);
    this.amb.color = sk.sky.clone().lerp(this.tint.setHex(0xffffff), 0.5);
    this.amb.groundColor = sk.ground;
    this.groundMat.color = sk.ground.clone().lerp(this.tint.setHex(0xffffff), 0.18);
    this.amb.intensity = sk.amb;
    this.key.color = sk.sun;
    this.key.intensity = sk.key;

    if (this.asphaltMat) {
      this.asphaltMat.color.setHex(this.isRain ? 0x151214 : 0x2f2a2c);
    }

    const dark = h < 6.2 || h > 17.6 || this.isRain;
    this.lamps.visible = dark;
    this.windows.visible = dark;
    this.lights.visible = dark;
    this.rainMesh.visible = this.isRain;
    this.readout();
  }

  setCorridor(i: number): void {
    this.corridor = i;
    this.repopulate();
    this.readout();
  }

  setRain(rain: boolean): void {
    this.isRain = rain;
    this.setHour(this.hour, true);
  }

  setCameraPreset(preset: CameraPreset): void {
    this.cameraPreset = preset;
    this.userLooking = false;
    if (preset === 'orbit') {
      this.targetTheta = this.baseTheta;
      this.targetPhi = 0.24;
      this.targetRadius = 84;
      this.targetOffsetY = 7;
    } else if (preset === 'overpass') {
      this.targetTheta = -Math.PI / 2;
      this.targetPhi = 0.52;
      this.targetRadius = 60;
      this.targetOffsetY = 16;
    } else if (preset === 'driver') {
      this.targetTheta = -Math.PI / 2 + 0.28;
      this.targetPhi = 0.08;
      this.targetRadius = 38;
      this.targetOffsetY = 1.8;
    }
    if (REDUCED) {
      this.theta = this.targetTheta;
      this.phi = this.targetPhi;
      this.radius = this.targetRadius;
      this.renderOnce();
    }
  }

  private readout(): void {
    this.onReadout?.({
      hour: this.hour,
      corridor: CORRIDORS[this.corridor]?.name ?? '',
      kmh: this.conditions().kmh,
      isRain: this.isRain,
    });
  }

  /* ---------- drawing ---------- */

  private paint(): void {
    const d = this.dummy;
    let n = 0;
    let an = 0;
    let ln = 0;
    const headlights = this.lights.visible;

    for (const p of this.model.placements(MAX_VEHICLES)) {
      const k = p.kind;
      d.position.set(p.x, k.h / 2, p.z);
      d.scale.set(k.len, k.h, k.w);
      d.rotation.set(0, 0, 0);
      d.updateMatrix();
      this.bodies.setMatrixAt(n, d.matrix);
      this.bodies.setColorAt(n, this.tint.setHex(BODY_COLORS[p.color % BODY_COLORS.length]!));

      // vehicle specific cabin/accent features
      if (k.type === 'motorcycle') {
        // Rider silhouette
        d.position.set(p.x - p.dir * 0.2, k.h * 1.1, p.z);
        d.scale.set(0.65, 0.75, 0.55);
        d.updateMatrix();
        this.cabins.setMatrixAt(n, d.matrix);
      } else if (k.type === 'leguna') {
        // Leguna: compact driver cab + passenger cage frame
        d.position.set(p.x + p.dir * k.len * 0.2, k.h * 0.85, p.z);
        d.scale.set(k.len * 0.42, k.h * 0.52, k.w * 0.9);
        d.updateMatrix();
        this.cabins.setMatrixAt(n, d.matrix);

        // Rear roof rack accent
        d.position.set(p.x - p.dir * k.len * 0.2, k.h * 0.82, p.z);
        d.scale.set(k.len * 0.44, k.h * 0.45, k.w * 0.88);
        d.updateMatrix();
        this.accents.setMatrixAt(an++, d.matrix);
      } else if (k.type === 'rickshaw') {
        // Rickshaw hood
        d.position.set(p.x - p.dir * k.len * 0.15, k.h * 0.85, p.z);
        d.scale.set(k.len * 0.55, k.h * 0.65, k.w * 0.95);
        d.updateMatrix();
        this.cabins.setMatrixAt(n, d.matrix);
      } else {
        // Cars, CNGs, Buses, Trucks
        d.position.set(p.x + p.dir * k.len * 0.06, k.h * 0.78, p.z);
        d.scale.set(k.len * k.cab, k.h * 0.42, k.w * 0.86);
        d.updateMatrix();
        this.cabins.setMatrixAt(n, d.matrix);
      }

      if (headlights) {
        if (k.type === 'motorcycle') {
          // Single central headlight
          d.position.set(p.x + p.dir * (k.len / 2 - 0.05), k.h * 0.45, p.z);
          d.scale.set(0.24, 0.22, 0.24);
          d.updateMatrix();
          this.lights.setMatrixAt(ln++, d.matrix);
        } else {
          for (const side of [-1, 1]) {
            d.position.set(p.x + p.dir * (k.len / 2 - 0.1), k.h * 0.42, p.z + side * k.w * 0.32);
            d.scale.set(0.28, 0.22, 0.34);
            d.updateMatrix();
            this.lights.setMatrixAt(ln++, d.matrix);
          }
        }
      }
      n++;
    }

    this.bodies.count = n;
    this.cabins.count = n;
    this.accents.count = an;
    this.lights.count = ln;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.cabins.instanceMatrix.needsUpdate = true;
    this.accents.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;

    // Rain simulation update
    if (this.isRain && this.rainPositions) {
      const count = this.rainMesh.count;
      for (let i = 0; i < count; i++) {
        let py = this.rainPositions[i * 3 + 1]! - 1.2;
        if (py < 0) py = 42 + Math.random() * 5;
        this.rainPositions[i * 3 + 1] = py;

        d.position.set(
          this.rainPositions[i * 3]!,
          py,
          this.rainPositions[i * 3 + 2]!,
        );
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        this.rainMesh.setMatrixAt(i, d.matrix);
      }
      this.rainMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /* ---------- camera ---------- */

  private bindDrag(): void {
    const el = this.el;
    let on = false;
    let px = 0;
    let py = 0;
    el.addEventListener('pointerdown', (e) => {
      on = true;
      px = e.clientX;
      py = e.clientY;
      this.userLooking = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!on) return;
      const lo = this.baseTheta - 0.75;
      const hi = this.baseTheta + 0.75;
      this.theta = Math.max(lo, Math.min(hi, this.theta - (e.clientX - px) * 0.005));
      this.phi = Math.max(0.04, Math.min(0.86, this.phi + (e.clientY - py) * 0.0035));
      this.targetTheta = this.theta;
      this.targetPhi = this.phi;
      px = e.clientX;
      py = e.clientY;
      if (REDUCED) this.renderOnce();
    });
    // Releases the pointer capture taken on pointerdown. Without this a drag
    // that ends outside the canvas can leave the element holding capture, and
    // it stops responding to later input.
    const stop = (event: PointerEvent): void => {
      if (!on) return;
      on = false;
      el.classList.remove('dragging');
      try {
        if (el.hasPointerCapture(event.pointerId)) {
          el.releasePointerCapture(event.pointerId);
        }
      } catch {
        // some browsers throw on a pointer id they no longer know about
      }
    };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
  }

  private place(): void {
    const cz = this.radius * Math.cos(this.phi) * Math.cos(this.theta);
    // lift clear of rooftops when swinging over buildings
    const over = Math.max(0, Math.abs(cz) - 10.5);
    this.camera.position.set(
      this.target.x + this.radius * Math.cos(this.phi) * Math.sin(this.theta),
      this.target.y + this.radius * Math.sin(this.phi) + this.targetOffsetY + over * 1.7,
      this.target.z + cz,
    );
    this.camera.lookAt(this.target);
  }

  resize(): void {
    const r = this.el.getBoundingClientRect();
    if (!r.width) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    if (REDUCED) this.renderOnce();
  }

  private frame(dt: number): void {
    this.t += dt;

    // Smooth camera interpolation towards target preset
    if (!this.userLooking) {
      if (this.cameraPreset === 'orbit') {
        this.theta += (this.targetTheta + Math.sin(this.t * 0.1) * 0.075 - this.theta) * 0.05;
      } else {
        this.theta += (this.targetTheta - this.theta) * 0.08;
      }
      this.phi += (this.targetPhi - this.phi) * 0.08;
      this.radius += (this.targetRadius - this.radius) * 0.08;
    }

    this.place();
    this.model.step(Math.min(dt, 0.05));
    this.paint();
    this.renderer.render(this.scene, this.camera);
  }

  /** One frame, nothing moving. What reduced motion gets. */
  renderOnce(): void {
    this.place();
    this.paint();
    this.renderer.render(this.scene, this.camera);
  }

  start(): void {
    if (this.raf !== null) return;
    if (REDUCED) {
      this.renderOnce();
      return;
    }
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = (now - last) / 1000;
      last = now;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  dispose(): void {
    this.stop();

    // Clearing the scene graph drops the references but not the GPU memory:
    // geometries and materials hold buffers and textures that only their own
    // dispose() releases. Without this the whole city leaks every time the
    // scene is torn down and rebuilt.
    this.scene.traverse((obj) => {
      if (obj instanceof Mesh || obj instanceof InstancedMesh) {
        obj.geometry?.dispose();
        if (Array.isArray(obj.material)) {
          for (const material of obj.material) material.dispose();
        } else if (obj.material) {
          obj.material.dispose();
        }
      }
    });

    this.city.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
