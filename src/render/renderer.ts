// Le rendu lit le monde et dessine. Il ne modifie jamais l'état.

import { LANE_OFF, STOP_BACK } from '../sim/constants';
import { thoughtIcon } from '../sim/query';
import { hash01 } from '../sim/rng';
import { carPose, type Pose } from '../sim/roadgeo';
import { GREEN, YELLOW, lightFor } from '../sim/traffic';
import {
  CAR_CRASHED, CAR_DRIVING, CAR_WORKING, DX, DY, LOC_CAR, LOC_DOWN, LOC_IN, LOC_WALK,
  type Building, type City, type Dir, type Person, type World,
} from '../sim/types';
import { isOpen } from '../sim/people';
import { minuteOfDay } from '../sim/world';
import { Camera } from './camera';
import { daylight, tint, type Daylight } from './daylight';
import { drawCar, drawPerson, topColor, type CarView } from './entities';
import { Ground } from './ground';
import { ZS, buildingModel, lampModel, treeModel, type Win } from './models';
import { SpriteCache, bucketFor, type Sprite } from './sprites';

const K_SLICE = 0, K_TREE = 1, K_LAMP = 2, K_LIGHT = 3, K_PERSON = 4, K_CAR = 5;

interface StaticItem { key: number; kind: number; ref: number; row: number; x: number; y: number }

export type Selection = { type: 'person' | 'building'; id: number } | null;

export interface FrameInfo {
  alpha: number; // interpolation entre le tick précédent et le tick courant
  timeMs: number;
  selection: Selection;
  labels: boolean;
}

const pose: Pose = { x: 0, y: 0, hx: 1, hy: 0 };

export class Renderer {
  readonly cam = new Camera();
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private city!: City;
  private ground!: Ground;
  private sprites: SpriteCache;
  private statics: StaticItem[] = [];
  private glow: HTMLCanvasElement;
  private mobile: boolean;
  private icons = new Map<string, HTMLCanvasElement>();
  private winRows = new Map<number, Win[][]>();
  private lit = new Float32Array(0);
  private litFrame = 0;
  // Positions au tick précédent, pour l'interpolation.
  private pX = new Float32Array(0); private pY = new Float32Array(0); private pOn = new Uint8Array(0);
  private hX = new Float32Array(0); private hY = new Float32Array(0);
  private cX = new Float32Array(0); private cY = new Float32Array(0); private cHX = new Float32Array(0); private cHY = new Float32Array(0);
  private cOn = new Uint8Array(0); private cV = new Float32Array(0);
  // Éléments mobiles de l'image courante.
  private dKey = new Float64Array(1024); private dKind = new Uint8Array(1024); private dRef = new Int32Array(1024);
  private dX = new Float32Array(1024); private dY = new Float32Array(1024); private dA = new Float32Array(1024); private dB = new Float32Array(1024);
  private dOrder: number[] = [];
  private dn = 0;
  // Cibles cliquables de l'image courante.
  private hitId = new Int32Array(1024); private hitX = new Float32Array(1024); private hitY = new Float32Array(1024);
  private hn = 0;
  day: Daylight = daylight(600);
  stats = { drawn: 0, ms: 0 };
  /** Plafond de densité de pixels ; abaissé si l'appareil peine. */
  maxDpr = 2;

  constructor(private canvas: HTMLCanvasElement, world: World) {
    this.ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    this.mobile = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.sprites = new SpriteCache(this.mobile ? 14e6 : 30e6);
    this.glow = makeGlow();
    this.setWorld(world);
  }

  setWorld(world: World): void {
    this.city = world.city;
    this.ground = new Ground(world.city, this.mobile ? 26 : 60);
    this.sprites.clear();
    this.winRows.clear();
    const items: StaticItem[] = [];
    const city = world.city;
    const key = (x: number, y: number) => Math.floor(y) * 1024 + x + (y - Math.floor(y));
    for (const b of city.buildings) {
      if (b.kind === 'park') continue;
      for (let r = 0; r < b.h; r++) items.push({ key: (b.y + r) * 1024 + b.x + 0.999, kind: K_SLICE, ref: b.id, row: r, x: b.x, y: b.y });
    }
    city.trees.forEach((t, i) => items.push({ key: key(t.x, t.y), kind: K_TREE, ref: i, row: 0, x: t.x, y: t.y }));
    city.lamps.forEach((l, i) => items.push({ key: key(l.x, l.y), kind: K_LAMP, ref: i, row: 0, x: l.x, y: l.y }));
    for (const n of city.nodes) {
      if (n.control !== 'lights') continue;
      for (let d = 0; d < 4; d++) {
        if (n.out[d] === -1) continue;
        const dx = DX[d as Dir], dy = DY[d as Dir];
        const x = n.x + 0.5 + dx * (0.5 + STOP_BACK) + dy * 0.44;
        const y = n.y + 0.5 + dy * (0.5 + STOP_BACK) - dx * 0.44;
        items.push({ key: key(x, y), kind: K_LIGHT, ref: n.id * 4 + d, row: 0, x, y });
      }
    }
    items.sort((a, b) => a.key - b.key);
    this.statics = items;
    const np = world.state.people.length, nc = world.state.cars.length;
    this.pX = new Float32Array(np); this.pY = new Float32Array(np); this.pOn = new Uint8Array(np);
    this.hX = new Float32Array(np).fill(1); this.hY = new Float32Array(np);
    this.cX = new Float32Array(nc); this.cY = new Float32Array(nc); this.cHX = new Float32Array(nc); this.cHY = new Float32Array(nc);
    this.cOn = new Uint8Array(nc); this.cV = new Float32Array(nc);
    this.lit = new Float32Array(city.buildings.length);
    this.litFrame = 0;
    this.resize();
    this.cam.fit(city.w, city.h);
  }

  resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (this.canvas.width === Math.round(w * dpr) && this.canvas.height === Math.round(h * dpr) && dpr === this.dpr) return false;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.cam.w = w;
    this.cam.h = h;
    return true;
  }

  /** À appeler juste avant un pas de simulation : mémorise les positions pour l'interpolation. */
  capture(world: World): void {
    const P = world.state.people, C = world.state.cars;
    for (let i = 0; i < P.length; i++) {
      const p = P[i]!;
      if (p.loc === LOC_WALK || p.loc === LOC_DOWN) { this.pX[i] = p.x; this.pY[i] = p.y; this.pOn[i] = 1; }
      else this.pOn[i] = 0;
    }
    for (let i = 0; i < C.length; i++) {
      const c = C[i]!;
      if (c.st === CAR_DRIVING || c.st === CAR_CRASHED || c.st === CAR_WORKING) {
        carPose(world.city, c, pose);
        this.cX[i] = pose.x; this.cY[i] = pose.y; this.cHX[i] = pose.hx; this.cHY[i] = pose.hy; this.cOn[i] = 1; this.cV[i] = c.v;
      } else this.cOn[i] = 0;
    }
  }

  private push(kind: number, ref: number, x: number, y: number, a = 0, b = 0): void {
    if (this.dn >= this.dKey.length) return;
    const i = this.dn++;
    this.dKey[i] = Math.floor(y) * 1024 + x + (y - Math.floor(y));
    this.dKind[i] = kind; this.dRef[i] = ref; this.dX[i] = x; this.dY[i] = y; this.dA[i] = a; this.dB[i] = b;
  }

  /** Position d'un promeneur dans un parc : fonction pure de son identité et du temps. */
  private wander(p: Person, b: Building, time: number): [number, number, boolean] {
    const period = p.age < 14 ? 120 : 250;
    const tt = (time + p.id * 37) / period;
    const slot = Math.floor(tt);
    const f = tt - slot;
    const pt = (k: number): [number, number] => {
      let x = b.x + 0.3 + hash01(p.id * 7 + k, 1) * (b.w - 0.6);
      let y = b.y + 0.3 + hash01(p.id * 7 + k, 2) * (b.h - 0.6);
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const dx = x - cx, dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.9) { x = cx + (dx / (d || 1)) * 0.9; y = cy + (dy / (d || 1)) * 0.9; }
      return [x, y];
    };
    const a = pt(slot), c = pt(slot + 1);
    let u = Math.max(0, (f - 0.35) / 0.65);
    u = u * u * (3 - 2 * u);
    return [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, f > 0.36 && f < 0.99];
  }

  private collect(world: World, alpha: number): void {
    const { state, city } = world;
    const t = state.tick;
    this.dn = 0;
    const P = state.people;
    for (let i = 0; i < P.length; i++) {
      const p = P[i]!;
      if (p.loc === LOC_WALK || p.loc === LOC_DOWN) {
        let x = p.x, y = p.y;
        if (this.pOn[i]) {
          const dx = p.x - this.pX[i]!, dy = p.y - this.pY[i]!;
          const d2 = dx * dx + dy * dy;
          if (d2 < 1) { x = this.pX[i]! + dx * alpha; y = this.pY[i]! + dy * alpha; }
          if (d2 > 1e-6) { const d = Math.sqrt(d2); this.hX[i] = dx / d; this.hY[i] = dy / d; }
          // On marche à droite du trottoir.
          x += -this.hY[i]! * 0.045;
          y += this.hX[i]! * 0.045;
          this.push(K_PERSON, i, x, y, d2 > 1e-6 ? 1 : 0, p.loc === LOC_DOWN ? 1 : 0);
        } else this.push(K_PERSON, i, x, y, 0, p.loc === LOC_DOWN ? 1 : 0);
      } else if (p.loc === LOC_IN && p.doing) {
        const b = city.buildings[p.at]!;
        if (b.kind !== 'park') continue;
        const chatting = t < p.chatUntil;
        const [x, y, moving] = this.wander(p, b, chatting ? Math.floor(p.chatUntil / 250) * 250 : t + alpha);
        this.push(K_PERSON, i, x, y, moving && !chatting ? 1 : 0, 0);
      }
    }
    const C = state.cars;
    for (let i = 0; i < C.length; i++) {
      const c = C[i]!;
      if (c.st !== CAR_DRIVING && c.st !== CAR_CRASHED && c.st !== CAR_WORKING) continue;
      carPose(city, c, pose);
      let x = pose.x, y = pose.y, hx = pose.hx, hy = pose.hy;
      if (this.cOn[i]) {
        const dx = x - this.cX[i]!, dy = y - this.cY[i]!;
        if (dx * dx + dy * dy < 1) {
          x = this.cX[i]! + dx * alpha; y = this.cY[i]! + dy * alpha;
          hx = this.cHX[i]! + (hx - this.cHX[i]!) * alpha; hy = this.cHY[i]! + (hy - this.cHY[i]!) * alpha;
        }
      }
      if (c.kind !== 0 && c.st !== CAR_CRASHED) {
        // Les secours roulent à cheval sur la ligne médiane.
        x -= -hy * LANE_OFF * 0.8;
        y -= hx * LANE_OFF * 0.8;
      }
      this.push(K_CAR, i, x, y, hx, hy);
    }
    const n = this.dn;
    const order = this.dOrder;
    order.length = n;
    for (let i = 0; i < n; i++) order[i] = i;
    const keys = this.dKey;
    order.sort((a, b) => keys[a]! - keys[b]!);
  }

  private litLevels(world: World): void {
    const { city, state, rt } = world;
    const minute = minuteOfDay(state.tick);
    for (const b of city.buildings) {
      const occ = rt.occupants[b.id]!;
      let level = 0;
      if (b.kind === 'house' || b.kind === 'apartment') {
        let awake = 0;
        for (const id of occ) { const p = state.people[id]!; if (!(p.act === 'sleep' && p.doing)) awake++; }
        level = awake === 0 ? 0 : b.kind === 'house' ? 0.85 : Math.min(1, 0.15 + (awake / Math.max(1, b.units * 1.6)) * 0.85);
      } else if (b.kind === 'hospital') level = 0.55;
      else if (b.kind === 'office' || b.kind === 'school' || b.kind === 'townhall' || b.kind === 'garage') level = occ.length ? Math.min(1, 0.15 + occ.length / Math.max(1, b.jobs)) : 0.03;
      else level = isOpen(b, minute) ? 0.95 : 0.04;
      this.lit[b.id] = level;
    }
  }

  render(world: World, frame: FrameInfo): void {
    const t0 = performance.now();
    this.resize();
    const { ctx, cam } = this;
    const city = world.city;
    const day = (this.day = daylight(minuteOfDay(world.state.tick)));
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (day.night > 0.1 && this.litFrame++ % 20 === 0) this.litLevels(world);

    // Ciel.
    const sky = ctx.createLinearGradient(0, 0, 0, cam.h);
    sky.addColorStop(0, day.skyTop);
    sky.addColorStop(1, day.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, cam.w, cam.h);
    if (day.night > 0.3) this.stars(day.night);

    // Socle : la ville est posée comme une maquette.
    const T = cam.zoom * 0.42;
    const nx = cam.sx(0, 0), ny = cam.sy(0, 0);
    const ex = cam.sx(city.w, 0), ey = cam.sy(city.w, 0);
    const sx = cam.sx(city.w, city.h), sy = cam.sy(city.w, city.h);
    const wx = cam.sx(0, city.h), wy = cam.sy(0, city.h);
    ctx.fillStyle = 'rgba(30,40,60,0.13)';
    quad(ctx, wx + T, wy + T * 1.25, sx, sy + T * 1.9, ex - T, ey + T * 1.25, sx, sy);
    ctx.fillStyle = '#a98f6c';
    quad(ctx, wx, wy, sx, sy, sx, sy + T, wx, wy + T);
    ctx.fillStyle = '#8c7556';
    quad(ctx, sx, sy, ex, ey, ex, ey + T, sx, sy + T);
    ctx.fillStyle = '#93b86c';
    quad(ctx, wx, wy, sx, sy, sx, sy + T * 0.16, wx, wy + T * 0.16);
    ctx.fillStyle = '#7fa35e';
    quad(ctx, sx, sy, ex, ey, ex, ey + T * 0.16, sx, sy + T * 0.16);
    // Le canal se déverse au bord de la maquette.
    const c0x = cam.sx(city.canalX, city.h), c0y = cam.sy(city.canalX, city.h);
    const c1x = cam.sx(city.canalX + city.canalW, city.h), c1y = cam.sy(city.canalX + city.canalW, city.h);
    ctx.fillStyle = '#62aecd';
    quad(ctx, c0x, c0y, c1x, c1y, c1x, c1y + T, c0x, c0y + T);

    this.ground.draw(ctx, cam, this.dpr);
    this.water(frame.timeMs);

    // Nuit : on assombrit le sol d'un seul aplat multiplicatif.
    if (day.night > 0.01) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = day.ambientCss;
      ctx.beginPath();
      ctx.moveTo(nx, ny - 1);
      ctx.lineTo(ex + 1, ey);
      ctx.lineTo(ex + 1, ey + T);
      ctx.lineTo(sx, sy + T + 1);
      ctx.lineTo(wx - 1, wy + T);
      ctx.lineTo(wx - 1, wy);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (day.night > 0.12) this.lampPools(day.night);

    this.collect(world, frame.alpha);
    this.groundOverlays(world, frame, day);
    this.sortedPass(world, frame, day);
    this.overlays(world, frame, day);

    // Voile doré de l'aube et du crépuscule.
    if (day.warm > 0.02) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = `rgba(255,150,70,${(day.warm * 0.42).toFixed(3)})`;
      ctx.fillRect(0, 0, cam.w, cam.h);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.stats.ms = performance.now() - t0;
  }

  private stars(night: number): void {
    const { ctx, cam } = this;
    ctx.fillStyle = `rgba(255,255,240,${(night * 0.7).toFixed(2)})`;
    for (let i = 0; i < 70; i++) {
      const x = ((i * 7919) % 1000) / 1000 * cam.w;
      const y = ((i * 104729) % 1000) / 1000 * cam.h;
      const s = i % 7 === 0 ? 1.6 : 1;
      ctx.fillRect(x, y, s, s);
    }
  }

  /** Reflets qui dérivent sur le canal. */
  private water(timeMs: number): void {
    const { ctx, cam, city } = this;
    const z = cam.zoom;
    if (z < 18) return;
    ctx.fillStyle = 'rgba(255,255,255,0.33)';
    const drift = timeMs / 9000;
    for (let i = 0; i < city.h * 2; i++) {
      const fx = hash01(i, 3), fy = hash01(i, 4);
      const wx = city.canalX + 0.25 + fx * (city.canalW - 0.9);
      const wy = (i / 2 + fy + drift * (0.6 + fx)) % city.h;
      if (city.tiles[Math.floor(wy) * city.w + Math.floor(wx)] !== 4) continue;
      const x = cam.sx(wx, wy), y = cam.sy(wx, wy);
      if (x < -20 || x > cam.w + 20 || y < -20 || y > cam.h + 20) continue;
      const l = z * (0.12 + fy * 0.14);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + l, y + l * 0.5);
      ctx.lineTo(x + l, y + l * 0.5 + Math.max(1, z * 0.012));
      ctx.lineTo(x, y + Math.max(1, z * 0.012));
      ctx.fill();
    }
  }

  private lampPools(night: number): void {
    const { ctx, cam, glow } = this;
    const z = cam.zoom;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, night) * 0.5;
    const w = z * 2.1, h = z * 1.05;
    for (const l of this.city.lamps) {
      // La flaque de lumière tombe côté chaussée.
      const lx = l.x - (l.x - Math.floor(l.x) - 0.5) * 0.5;
      const ly = l.y - (l.y - Math.floor(l.y) - 0.5) * 0.5;
      const x = cam.sx(lx, ly), y = cam.sy(lx, ly);
      if (x < -w || x > cam.w + w || y < -h || y > cam.h + h) continue;
      ctx.drawImage(glow, x - w / 2, y - h / 2, w, h);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Tracés au sol : phares, itinéraire et anneau de l'habitant sélectionné. */
  private groundOverlays(world: World, frame: FrameInfo, day: Daylight): void {
    const { ctx, cam, glow } = this;
    const z = cam.zoom;
    const { state, city } = world;
    if (day.night > 0.25) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = day.night * 0.55;
      const w = z * 1.5, h = z * 0.75;
      for (let i = 0; i < this.dn; i++) {
        if (this.dKind[i] !== K_CAR || state.cars[this.dRef[i]!]!.st === CAR_CRASHED) continue;
        const fx = this.dX[i]! + this.dA[i]! * 0.55, fy = this.dY[i]! + this.dB[i]! * 0.55;
        const x = cam.sx(fx, fy), y = cam.sy(fx, fy);
        if (x < -w || x > cam.w + w || y < -h || y > cam.h + h) continue;
        ctx.drawImage(glow, x - w / 2, y - h / 2, w, h);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    const sel = frame.selection;
    if (sel?.type === 'building') {
      const b = city.buildings[sel.id]!;
      const pulse = 0.5 + 0.5 * Math.sin(frame.timeMs / 300);
      ctx.strokeStyle = `rgba(255,255,255,${0.6 + 0.4 * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cam.sx(b.x, b.y), cam.sy(b.x, b.y));
      ctx.lineTo(cam.sx(b.x + b.w, b.y), cam.sy(b.x + b.w, b.y));
      ctx.lineTo(cam.sx(b.x + b.w, b.y + b.h), cam.sy(b.x + b.w, b.y + b.h));
      ctx.lineTo(cam.sx(b.x, b.y + b.h), cam.sy(b.x, b.y + b.h));
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.fill();
    }
    if (sel?.type !== 'person') return;
    const p = state.people[sel.id];
    if (!p) return;
    // Itinéraire restant.
    ctx.lineWidth = Math.max(2, z * 0.035);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([ctx.lineWidth * 0.2, ctx.lineWidth * 2.2]);
    ctx.lineDashOffset = -frame.timeMs / 60;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    let started = false;
    ctx.beginPath();
    const to = (x: number, y: number) => { started ? ctx.lineTo(cam.sx(x, y), cam.sy(x, y)) : ctx.moveTo(cam.sx(x, y), cam.sy(x, y)); started = true; };
    if (p.loc === LOC_WALK && p.walk) {
      to(p.x, p.y);
      for (let i = p.walk.i * 2; i < p.walk.pts.length; i += 2) to(p.walk.pts[i]!, p.walk.pts[i + 1]!);
    } else if (p.loc === LOC_CAR && p.car >= 0) {
      const c = state.cars[p.car]!;
      if (c.st === CAR_DRIVING && c.route.length) {
        carPose(city, c, pose);
        to(pose.x, pose.y);
        for (let i = c.ri; i < c.route.length; i++) {
          const ed = city.edges[c.route[i]!]!;
          const last = i === c.route.length - 1;
          if (i > c.ri) to(ed.x0, ed.y0);
          const s = last ? c.destS : ed.len;
          to(ed.x0 + DX[ed.dir] * s, ed.y0 + DY[ed.dir] * s);
        }
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (started && p.dest >= 0 && !p.doing) {
      // Destination.
      const b = city.buildings[p.dest]!;
      const x = cam.sx(b.doorX, b.doorY), y = cam.sy(b.doorX, b.doorY);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, Math.max(3, z * 0.06), 0, 6.2832);
      ctx.fill();
    }
  }

  private blit(s: Sprite, x: number, y: number, scale: number, day: Daylight): void {
    const { ctx } = this;
    const dx = x + s.ox * scale, dy = y + s.oy * scale, dw = s.w * scale, dh = s.h * scale;
    if (day.level >= 16) ctx.drawImage(this.sprites.nightOf(s), dx, dy, dw, dh);
    else {
      ctx.drawImage(s.day, dx, dy, dw, dh);
      if (day.level > 0) {
        ctx.globalAlpha = day.night;
        ctx.drawImage(this.sprites.nightOf(s), dx, dy, dw, dh);
        ctx.globalAlpha = 1;
      }
    }
  }

  private windows(b: Building, row: number, x: number, y: number, z: number, night: number): void {
    const level = this.lit[b.id]!;
    if (level <= 0) return;
    let rows = this.winRows.get(b.id);
    if (!rows) {
      rows = [];
      for (let r = 0; r < b.h; r++) rows.push([]);
      for (const w of buildingModel(b).wins) rows[Math.max(0, Math.min(b.h - 1, w.row))]!.push(w);
      this.winRows.set(b.id, rows);
    }
    const wins = rows[row]!;
    if (!wins.length) return;
    const { ctx } = this;
    ctx.globalAlpha = Math.min(1, night * 1.25);
    for (let pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass === 0 ? '#ffe2a0' : '#f5c574';
      ctx.beginPath();
      let any = false;
      for (const w of wins) {
        if (w.thr >= level || w.east !== (pass === 1)) continue;
        any = true;
        const p = w.pts;
        ctx.moveTo(x + p[0]! * z, y + p[1]! * z);
        ctx.lineTo(x + p[2]! * z, y + p[3]! * z);
        ctx.lineTo(x + p[4]! * z, y + p[5]! * z);
        ctx.lineTo(x + p[6]! * z, y + p[7]! * z);
      }
      if (any) ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private sortedPass(world: World, frame: FrameInfo, day: Daylight): void {
    const { ctx, cam, city } = this;
    const { state } = world;
    const z = cam.zoom;
    const bucket = bucketFor(z * this.dpr);
    const tick = state.tick;
    this.sprites.beginFrame();
    this.hn = 0;
    let drawn = 0;
    const order = this.dOrder;
    let di = 0;
    const dn = this.dn;
    const sxf = (x: number, y: number) => cam.sx(x, y);
    const syf = (x: number, y: number) => cam.sy(x, y);
    const view: CarView = { x: 0, y: 0, hx: 1, hy: 0, crashed: false, braking: false };
    const drawDyn = (i: number) => {
      const wx = this.dX[i]!, wy = this.dY[i]!;
      const x = cam.sx(wx, wy), y = cam.sy(wx, wy);
      if (x < -z || x > cam.w + z || y < -z || y > cam.h + z) return;
      const ref = this.dRef[i]!;
      if (this.dKind[i] === K_PERSON) {
        const p = state.people[ref]!;
        drawPerson(ctx, p, x, y, z, frame.timeMs * 0.011 + p.id, this.dA[i] === 1, this.dB[i] === 1, day);
        if (this.hn < 1024) { this.hitId[this.hn] = ref; this.hitX[this.hn] = x; this.hitY[this.hn] = y - z * 0.1; this.hn++; }
      } else {
        const c = state.cars[ref]!;
        view.x = wx; view.y = wy; view.hx = this.dA[i]!; view.hy = this.dB[i]!;
        view.crashed = c.st === CAR_CRASHED;
        view.braking = c.st === CAR_DRIVING && (c.v < this.cV[ref]! - 0.003 || c.v < 0.012);
        if (view.crashed) {
          // De travers après le choc.
          const a = (hash01(c.id, 9) - 0.5) * 1.1;
          const cs = Math.cos(a), sn = Math.sin(a);
          const hx = view.hx * cs - view.hy * sn;
          view.hy = view.hx * sn + view.hy * cs;
          view.hx = hx;
        }
        drawCar(ctx, c, view, z, sxf, syf, frame.timeMs, day);
        if (c.owner >= 0 && this.hn < 1024) { this.hitId[this.hn] = c.owner; this.hitX[this.hn] = x; this.hitY[this.hn] = y - z * 0.05; this.hn++; }
      }
      drawn++;
    };
    for (const it of this.statics) {
      while (di < dn && this.dKey[order[di]!]! < it.key) drawDyn(order[di++]!);
      const x = cam.sx(it.x, it.y), y = cam.sy(it.x, it.y);
      if (it.kind === K_SLICE) {
        const b = city.buildings[it.ref]!;
        const m = buildingModel(b);
        if (x + m.bx1 * z < 0 || x + m.bx0 * z > cam.w || y + m.by1 * z < 0 || y + m.by0 * z > cam.h) continue;
        const sl = this.sprites.get(`b${b.id}`, m, bucket, true);
        const s = sl?.[Math.min(it.row, sl.length - 1)];
        if (!s) continue;
        this.blit(s, x, y, z, day);
        if (day.night > 0.12) this.windows(b, it.row, x, y, z, day.night);
        drawn++;
      } else if (it.kind === K_TREE) {
        if (x < -z || x > cam.w + z || y < -z * 0.2 || y > cam.h + z) continue;
        const t = city.trees[it.ref]!;
        const tone = it.ref % 6;
        const sl = this.sprites.get(`t${t.kind * 16 + tone}`, treeModel(t.kind, tone), bucketFor(z * this.dpr * t.size), false);
        if (!sl) continue;
        this.blit(sl[0]!, x, y, z * t.size, day);
        drawn++;
      } else if (it.kind === K_LAMP) {
        if (x < -z || x > cam.w + z || y < -z * 0.2 || y > cam.h + z) continue;
        if (z > 9) {
          const sl = this.sprites.get('lamp', lampModel(), bucket, false);
          if (sl) this.blit(sl[0]!, x, y, z, day);
        }
        if (day.night > 0.12) {
          const g = z * 0.5;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = day.night * 0.85;
          ctx.drawImage(this.glow, x - g / 2, y - 0.445 * ZS * z - g / 2, g, g);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
        drawn++;
      } else {
        // Feu tricolore.
        if (x < -z || x > cam.w + z || y < -z * 0.2 || y > cam.h + z) continue;
        const node = city.nodes[it.ref >> 2]!;
        const state2 = lightFor(node, (it.ref & 3) & 1, tick);
        const col = state2 === GREEN ? '#3fd07a' : state2 === YELLOW ? '#ffc23d' : '#f0473c';
        const hgt = 0.34 * ZS * z;
        if (z > 13) {
          ctx.fillStyle = tint('#3a4047', day);
          ctx.fillRect(x - Math.max(0.5, z * 0.012), y - hgt, Math.max(1, z * 0.024), hgt);
          ctx.fillRect(x - z * 0.03, y - hgt - z * 0.09, z * 0.06, z * 0.11);
        }
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y - hgt - z * (state2 === GREEN ? 0.01 : state2 === YELLOW ? 0.035 : 0.06), Math.max(1.3, z * 0.022), 0, 6.2832);
        ctx.fill();
        if (day.night > 0.3 && z > 13) {
          ctx.globalAlpha = 0.25;
          ctx.beginPath();
          ctx.arc(x, y - hgt - z * 0.035, z * 0.09, 0, 6.2832);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
    while (di < dn) drawDyn(order[di++]!);
    this.stats.drawn = drawn;
  }

  private icon(emoji: string): HTMLCanvasElement {
    let c = this.icons.get(emoji);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.fillStyle = 'rgba(40,30,20,0.18)';
      g.beginPath();
      g.arc(32, 31, 25, 0, 6.2832);
      g.fill();
      g.fillStyle = '#fffdf6';
      g.beginPath();
      g.arc(32, 29, 24, 0, 6.2832);
      g.moveTo(24, 48);
      g.lineTo(32, 62);
      g.lineTo(40, 48);
      g.fill();
      g.font = '28px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(emoji, 32, 31);
      this.icons.set(emoji, c);
    }
    return c;
  }

  /** Bulles, noms, repères : dessinés par-dessus la scène. */
  private overlays(world: World, frame: FrameInfo, day: Daylight): void {
    const { ctx, cam, city } = this;
    const { state } = world;
    const z = cam.zoom;
    const t = state.tick;
    const sel = frame.selection;
    const selPerson = sel?.type === 'person' ? sel.id : -1;

    // Enseignes des lieux : les plus importantes d'abord, sans chevauchement.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 11px system-ui, sans-serif';
    const placed: number[] = [];
    const label = (b: Building, strong: boolean): void => {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const x = cam.sx(cx, cy);
      const y = cam.sy(cx, cy) - (b.kind === 'park' ? 0 : buildingModel(b).top * ZS * z) - 12;
      if (x < -60 || x > cam.w + 60 || y < 40 || y > cam.h + 20) return;
      const w = ctx.measureText(b.name).width + 16;
      if (!strong) for (let i = 0; i < placed.length; i += 3) if (Math.abs(placed[i]! - x) < (placed[i + 2]! + w) / 2 + 4 && Math.abs(placed[i + 1]! - y) < 22) return;
      placed.push(x, y, w);
      this.pill(b.name, x, y, strong);
    };
    if (sel?.type === 'building') label(city.buildings[sel.id]!, true);
    if (frame.labels && z >= 44) {
      const tiers = [['hospital', 'townhall', 'school', 'cinema', 'park', 'garage'], ['cafe', 'restaurant', 'bar'], ['shop'], ['office']];
      const upTo = z >= 120 ? 4 : z >= 90 ? 3 : z >= 64 ? 2 : 1;
      for (let k = 0; k < upTo; k++) for (const kind of tiers[k]!) for (const id of city.byKind[kind] ?? []) if (!(sel?.type === 'building' && sel.id === id)) label(city.buildings[id]!, false);
    }

    // Bulles de pensée et prénoms.
    const showAll = z >= 78;
    const size = Math.max(18, Math.min(30, z * 0.26));
    let bubbles = 0;
    if (z >= 30) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = `600 ${z >= 130 ? 12 : 11}px system-ui, sans-serif`;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      for (let i = 0; i < this.dn; i++) {
        if (this.dKind[i] !== K_PERSON) continue;
        const p = state.people[this.dRef[i]!]!;
        const x = cam.sx(this.dX[i]!, this.dY[i]!), y = cam.sy(this.dX[i]!, this.dY[i]!);
        if (x < -30 || x > cam.w + 30 || y < -10 || y > cam.h + 40) continue;
        if (p.id !== selPerson && this.hidden(this.dX[i]!, this.dY[i]!)) continue;
        const special = t < p.chatUntil || t < p.shockUntil || t < p.distractUntil || p.watch >= 0 || p.loc === LOC_DOWN || (p.loc === LOC_WALK && p.wait > 12) || t < p.hurryUntil;
        if ((showAll || special || p.id === selPerson) && bubbles < 90) {
          const ic = thoughtIcon(world, p);
          if (ic) {
            const k = p.age < 12 ? 0.68 : 1;
            ctx.drawImage(this.icon(ic), x - size / 2, y - z * 0.2 * k - size * 1.08, size, size);
            bubbles++;
          }
        }
        if (z >= 96 || p.id === selPerson) {
          ctx.strokeStyle = 'rgba(255,253,246,0.9)';
          ctx.strokeText(p.first, x, y + 3);
          ctx.fillStyle = '#2f2a25';
          ctx.fillText(p.first, x, y + 3);
        }
      }
    }

    // Accidents en cours : repère visible de loin.
    for (const acc of state.accidents) {
      if (!acc.open) continue;
      const x = cam.sx(acc.x, acc.y), y = cam.sy(acc.x, acc.y);
      const bob = Math.sin(frame.timeMs / 220) * 3;
      const s = z < 30 ? 30 : 34;
      ctx.drawImage(this.icon('⚠️'), x - s / 2, y - Math.max(22, z * 0.5) - s + bob, s, s);
    }

    // Repère de l'habitant sélectionné.
    if (selPerson >= 0) {
      const p = state.people[selPerson];
      if (p) {
        let wx = -1, wy = -1, lift = z * 0.3;
        for (let i = 0; i < this.dn; i++) {
          if ((this.dKind[i] === K_PERSON && this.dRef[i] === p.id) || (this.dKind[i] === K_CAR && p.loc === LOC_CAR && this.dRef[i] === p.car)) { wx = this.dX[i]!; wy = this.dY[i]!; break; }
        }
        if (wx < 0) {
          const b = city.buildings[p.at]!;
          wx = b.x + b.w / 2; wy = b.y + b.h / 2;
          lift = (b.kind === 'park' ? 0.2 : buildingModel(b).top * ZS + 0.12) * z;
        }
        const x = cam.sx(wx, wy), y = cam.sy(wx, wy);
        const pulse = 0.5 + 0.5 * Math.sin(frame.timeMs / 260);
        ctx.strokeStyle = `rgba(255,255,255,${0.75 + 0.25 * pulse})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(x, y, Math.max(7, z * 0.17) + pulse * 2, Math.max(3.5, z * 0.085) + pulse, 0, 0, 6.2832);
        ctx.stroke();
        // Flèche au-dessus.
        const ay = y - lift - 14 - (z >= 30 ? size : 0) + pulse * 3;
        ctx.fillStyle = tint(topColor(p), day);
        ctx.strokeStyle = '#fffdf6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 8, ay - 10);
        ctx.lineTo(x + 8, ay - 10);
        ctx.lineTo(x, ay + 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  /** Le point au sol est-il caché derrière un bâtiment ? */
  private hidden(x: number, y: number): boolean {
    const { city } = this;
    for (let s = 0.2; s < 5; s += 0.25) {
      const tx = Math.floor(x + s), ty = Math.floor(y + s);
      if (tx >= city.w || ty >= city.h) return false;
      const id = city.lot[ty * city.w + tx]!;
      if (id < 0) continue;
      const b = city.buildings[id]!;
      if (b.kind === 'park') continue;
      const fx = x + s - b.x, fy = y + s - b.y;
      if (fx < 0.1 || fy < 0.1 || fx > b.w - 0.1 || fy > b.h - 0.1) continue;
      if (buildingModel(b).top * 0.8 > (s * 0.5) / ZS + 0.12) return true;
    }
    return false;
  }

  private pill(text: string, x: number, y: number, strong: boolean): void {
    const { ctx } = this;
    const w = ctx.measureText(text).width + 14;
    ctx.fillStyle = strong ? 'rgba(47,42,37,0.92)' : 'rgba(255,253,246,0.86)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 9.5, w, 19, 9.5);
    ctx.fill();
    ctx.fillStyle = strong ? '#fffdf6' : '#3a342d';
    ctx.fillText(text, x, y + 0.5);
  }

  /** Qu'y a-t-il sous ce point de l'écran ? Habitants d'abord, puis bâtiments. */
  pick(px: number, py: number): Selection {
    const { cam, city } = this;
    const z = cam.zoom;
    const r = Math.max(16, z * 0.22);
    let best = -1, bd = r * r;
    for (let i = 0; i < this.hn; i++) {
      const dx = this.hitX[i]! - px, dy = this.hitY[i]! - py;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = this.hitId[i]!; }
    }
    if (best >= 0) return { type: 'person', id: best };
    // Bâtiments, du plus proche au plus lointain : test sur la silhouette de la boîte englobante.
    for (let i = this.statics.length - 1; i >= 0; i--) {
      const it = this.statics[i]!;
      if (it.kind !== K_SLICE || it.row !== 0) continue;
      const b = city.buildings[it.ref]!;
      const top = buildingModel(b).top * ZS * z;
      const x0 = b.x + 0.06, y0 = b.y + 0.06, x1 = b.x + b.w - 0.06, y1 = b.y + b.h - 0.06;
      const hexa = [
        [cam.sx(x0, y1), cam.sy(x0, y1)], [cam.sx(x1, y1), cam.sy(x1, y1)], [cam.sx(x1, y0), cam.sy(x1, y0)],
        [cam.sx(x1, y0), cam.sy(x1, y0) - top], [cam.sx(x0, y0), cam.sy(x0, y0) - top], [cam.sx(x0, y1), cam.sy(x0, y1) - top],
      ];
      let inside = false;
      for (let a = 0, c = hexa.length - 1; a < hexa.length; c = a++) {
        const [ax, ay] = hexa[a] as [number, number], [bx, by] = hexa[c] as [number, number];
        if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
      }
      if (inside) return { type: 'building', id: b.id };
    }
    const [wx, wy] = cam.toWorld(px, py);
    const tx = Math.floor(wx), ty = Math.floor(wy);
    if (tx >= 0 && ty >= 0 && tx < city.w && ty < city.h) {
      const id = city.lot[ty * city.w + tx]!;
      if (id >= 0) return { type: 'building', id };
    }
    return null;
  }

  /** Position monde d'un habitant tel qu'il est dessiné (promeneurs de parc compris). */
  drawnPos(world: World, id: number): [number, number] | null {
    const p = world.state.people[id];
    if (!p) return null;
    for (let i = 0; i < this.dn; i++)
      if ((this.dKind[i] === K_PERSON && this.dRef[i] === id) || (this.dKind[i] === K_CAR && p.loc === LOC_CAR && this.dRef[i] === p.car)) return [this.dX[i]!, this.dY[i]!];
    if (p.loc === LOC_IN) {
      const b = world.city.buildings[p.at]!;
      return [b.x + b.w / 2, b.y + b.h / 2];
    }
    return null;
  }
}

function quad(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): void {
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  ctx.lineTo(dx, dy);
  ctx.closePath();
  ctx.fill();
}

function makeGlow(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
  grad.addColorStop(0, 'rgba(255,214,140,0.95)');
  grad.addColorStop(0.35, 'rgba(255,196,110,0.4)');
  grad.addColorStop(1, 'rgba(255,180,90,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 96, 96);
  return c;
}
