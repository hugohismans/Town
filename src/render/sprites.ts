// Cache de sprites : les modèles vectoriels sont rendus une fois par niveau
// de zoom, découpés en tranches (une par rangée de tuiles) pour que le tri en
// profondeur soit exact, puis réutilisés tant qu'ils tiennent dans le budget.

import { NIGHT_AMBIENT } from './daylight';
import { ZS, type Model } from './models';

export interface Sprite {
  day: HTMLCanvasElement;
  night: HTMLCanvasElement | null;
  ox: number; // position et taille en unités (largeurs de tuile)
  oy: number;
  w: number;
  h: number;
}

interface Entry {
  slices: Sprite[];
  px: number;
}

export const BUCKETS = [8, 16, 32, 64, 128, 256, 384];

export function bucketFor(need: number): number {
  for (const b of BUCKETS) if (b >= need * 0.8) return b;
  return BUCKETS[BUCKETS.length - 1] as number;
}

function drawModel(ctx: CanvasRenderingContext2D, model: Model, unit: number): void {
  ctx.lineWidth = 0.7 / unit;
  ctx.lineJoin = 'round';
  for (const p of model.polys) {
    ctx.fillStyle = p.fill;
    ctx.beginPath();
    if (p.ellipse) {
      ctx.ellipse(p.pts[0] as number, p.pts[1] as number, p.pts[2] as number, p.pts[3] as number, 0, 0, 6.2832);
      ctx.fill();
      continue;
    }
    ctx.moveTo(p.pts[0] as number, p.pts[1] as number);
    for (let i = 2; i < p.pts.length; i += 2) ctx.lineTo(p.pts[i] as number, p.pts[i + 1] as number);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = p.fill;
    ctx.stroke();
  }
}

export class SpriteCache {
  private map = new Map<string, Entry>();
  private pixels = 0;
  /** Temps de génération consommé pendant l'image courante (ms). */
  spent = 0;
  constructor(private budget: number) {}

  beginFrame(): void {
    this.spent = 0;
  }
  peek(id: string, bucket: number): Sprite[] | null {
    const key = `${id}@${bucket}`;
    const e = this.map.get(key);
    if (!e) return null;
    this.map.delete(key);
    this.map.set(key, e);
    return e.slices;
  }
  /** Sprite au bon niveau ; sinon le meilleur disponible pendant que le budget de l'image est épuisé. */
  get(id: string, model: Model, bucket: number, sliced: boolean, maxMs = 5): Sprite[] | null {
    const hit = this.peek(id, bucket);
    if (hit) return hit;
    if (this.spent > maxMs) {
      for (const b of BUCKETS) {
        const alt = this.peek(id, b);
        if (alt) return alt;
      }
      return null;
    }
    const t = performance.now();
    const slices = this.make(model, bucket, sliced);
    let px = 0;
    for (const s of slices) px += s.day.width * s.day.height;
    this.map.set(`${id}@${bucket}`, { slices, px });
    this.pixels += px;
    this.evict();
    this.spent += performance.now() - t;
    return slices;
  }
  nightOf(s: Sprite): HTMLCanvasElement {
    if (!s.night) {
      const c = document.createElement('canvas');
      c.width = s.day.width;
      c.height = s.day.height;
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      ctx.drawImage(s.day, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${NIGHT_AMBIENT[0]},${NIGHT_AMBIENT[1]},${NIGHT_AMBIENT[2]})`;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(s.day, 0, 0);
      s.night = c;
      this.pixels += c.width * c.height;
    }
    return s.night;
  }
  clear(): void {
    this.map.clear();
    this.pixels = 0;
  }
  private evict(): void {
    for (const [key, e] of this.map) {
      if (this.pixels <= this.budget) break;
      this.map.delete(key);
      this.pixels -= e.px;
      for (const s of e.slices) if (s.night) this.pixels -= s.night.width * s.night.height;
    }
  }
  private make(model: Model, unit: number, sliced: boolean): Sprite[] {
    const out: Sprite[] = [];
    const rows = sliced ? model.h : 1;
    const Z = model.top + 0.05;
    const P = (x: number, y: number, z: number): [number, number] => [(x - y) * 0.5, (x + y) * 0.25 - z * ZS];
    for (let r = 0; r < rows; r++) {
      let hexa: [number, number][] | null = null;
      let bx0 = model.bx0, by0 = model.by0, bx1 = model.bx1, by1 = model.by1;
      if (rows > 1) {
        const ya = r === 0 ? -0.4 : r;
        const yb = r === rows - 1 ? model.h + 0.4 : r + 1;
        const xa = -0.4, xb = model.w + 0.4;
        hexa = [P(xa, yb, 0), P(xb, yb, 0), P(xb, ya, 0), P(xb, ya, Z), P(xa, ya, Z), P(xa, yb, Z)];
        let hx0 = 1e9, hy0 = 1e9, hx1 = -1e9, hy1 = -1e9;
        for (const [x, y] of hexa) { hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x); hy0 = Math.min(hy0, y); hy1 = Math.max(hy1, y); }
        bx0 = Math.max(bx0, hx0); by0 = Math.max(by0, hy0); bx1 = Math.min(bx1, hx1); by1 = Math.min(by1, hy1);
      }
      const pad = 1.5 / unit;
      bx0 -= pad; by0 -= pad; bx1 += pad; by1 += pad;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil((bx1 - bx0) * unit));
      c.height = Math.max(1, Math.ceil((by1 - by0) * unit));
      const ctx = c.getContext('2d') as CanvasRenderingContext2D;
      ctx.setTransform(unit, 0, 0, unit, -bx0 * unit, -by0 * unit);
      if (hexa) {
        ctx.beginPath();
        hexa.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.clip();
      }
      drawModel(ctx, model, unit);
      out.push({ day: c, night: null, ox: bx0, oy: by0, w: c.width / unit, h: c.height / unit });
    }
    return out;
  }
}
