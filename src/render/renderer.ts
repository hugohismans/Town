// Le rendu lit le monde et dessine. Il ne modifie jamais l'état.

import { minuteOfDay } from '../sim/world';
import type { City, World } from '../sim/types';
import { Camera } from './camera';
import { daylight, type Daylight } from './daylight';
import { Ground } from './ground';
import { ZS, buildingModel, lampModel, treeModel } from './models';
import { SpriteCache, bucketFor, type Sprite } from './sprites';

const K_SLICE = 0;
const K_TREE = 1;
const K_LAMP = 2;

interface StaticItem {
  key: number;
  kind: number;
  ref: number;
  row: number;
}

export interface FrameInfo {
  alpha: number; // interpolation entre le tick précédent et le tick courant
  timeMs: number;
}

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
  day: Daylight = daylight(600);
  stats = { drawn: 0, ms: 0 };

  constructor(private canvas: HTMLCanvasElement, world: World) {
    this.ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    this.mobile = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.sprites = new SpriteCache(this.mobile ? 9e6 : 22e6);
    this.glow = makeGlow();
    this.setWorld(world);
  }

  setWorld(world: World): void {
    this.city = world.city;
    this.ground = new Ground(world.city, this.mobile ? 26 : 60);
    this.sprites.clear();
    const items: StaticItem[] = [];
    const city = world.city;
    for (const b of city.buildings) {
      if (b.kind === 'park') continue;
      for (let r = 0; r < b.h; r++) items.push({ key: (b.y + r) * 1024 + b.x + 0.999, kind: K_SLICE, ref: b.id, row: r });
    }
    city.trees.forEach((t, i) => items.push({ key: Math.floor(t.y) * 1024 + t.x + (t.y - Math.floor(t.y)), kind: K_TREE, ref: i, row: 0 }));
    city.lamps.forEach((l, i) => items.push({ key: Math.floor(l.y) * 1024 + l.x + (l.y - Math.floor(l.y)), kind: K_LAMP, ref: i, row: 0 }));
    items.sort((a, b) => a.key - b.key);
    this.statics = items;
    this.resize();
    this.cam.fit(city.w, city.h);
  }

  resize(): boolean {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

  render(world: World, _frame: FrameInfo): void {
    const t0 = performance.now();
    this.resize();
    const { ctx, cam } = this;
    const city = world.city;
    const day = (this.day = daylight(minuteOfDay(world.state.tick)));
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

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

    this.sortedPass(day);

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

  private sortedPass(day: Daylight): void {
    const { ctx, cam, city } = this;
    const z = cam.zoom;
    const bucket = bucketFor(z * this.dpr);
    this.sprites.beginFrame();
    let drawn = 0;
    for (const it of this.statics) {
      if (it.kind === K_SLICE) {
        const b = city.buildings[it.ref]!;
        const x = cam.sx(b.x, b.y), y = cam.sy(b.x, b.y);
        const m = buildingModel(b);
        if (x + m.bx1 * z < 0 || x + m.bx0 * z > cam.w || y + m.by1 * z < 0 || y + m.by0 * z > cam.h) continue;
        const sl = this.sprites.get(`b${b.id}`, m, bucket, true);
        const s = sl?.[Math.min(it.row, sl.length - 1)];
        if (!s) continue;
        this.blit(s, x, y, z, day);
        drawn++;
      } else if (it.kind === K_TREE) {
        const t = city.trees[it.ref]!;
        const x = cam.sx(t.x, t.y), y = cam.sy(t.x, t.y);
        if (x < -z || x > cam.w + z || y < -z * 0.2 || y > cam.h + z) continue;
        const tone = it.ref % 6;
        const sl = this.sprites.get(`t${t.kind * 16 + tone}`, treeModel(t.kind, tone), bucketFor(z * this.dpr * t.size), false);
        if (!sl) continue;
        this.blit(sl[0]!, x, y, z * t.size, day);
        drawn++;
      } else {
        const l = city.lamps[it.ref]!;
        const x = cam.sx(l.x, l.y), y = cam.sy(l.x, l.y);
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
      }
    }
    this.stats.drawn = drawn;
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
