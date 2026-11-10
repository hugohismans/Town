// Le sol : une liste d'opérations de dessin en coordonnées monde (tuiles),
// peintes soit directement (zoom fort), soit dans des dalles mises en cache.

import { hash01, hash32 } from '../sim/rng';
import { LANE_OFF, STOP_BACK, XW_OUT } from '../sim/constants';
import { DX, DY, T_FIELD, T_GARDEN, T_LOT, T_PARK, type City, type Dir, type RNode } from '../sim/types';
import { buildingModel } from './models';
import type { Camera } from './camera';

interface Op {
  k: 0 | 1 | 2 | 3; // rect, polygone, ellipse, texte
  x0: number; y0: number; x1: number; y1: number;
  fill: string;
  pts?: number[];
  text?: string;
  vertical?: boolean;
}

const CHUNK = 512;
const GROUND_BUCKETS = [8, 16, 32, 64, 128, 256];

const C = {
  grass: '#a7cf7c', grass2: '#9fc874', garden: ['#93c773', '#8cc26f', '#9bcc78'], park: '#8fcf7c',
  paving: ['#d9d1c1', '#d3cdbf', '#cfd6c0'], sidewalk: '#ded7c9', curb: '#b8b1a3', asphalt: '#62656d',
  mark: '#f1ecdf', water: '#74bcd8', water2: '#8fcde3', stone: '#bfb8a9', path: '#e6d9b8',
  fields: ['#d9c77a', '#c7d382', '#b9c66d', '#e2d291'], furrow: 'rgba(120,100,40,0.13)',
  shadow: 'rgba(35,45,80,0.17)',
};

export function buildGroundOps(city: City): Op[] {
  const ops: Op[] = [];
  const rect = (x: number, y: number, w: number, h: number, fill: string) => ops.push({ k: 0, x0: x, y0: y, x1: x + w, y1: y + h, fill });
  const poly = (pts: number[], fill: string) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i] as number); x1 = Math.max(x1, pts[i] as number);
      y0 = Math.min(y0, pts[i + 1] as number); y1 = Math.max(y1, pts[i + 1] as number);
    }
    ops.push({ k: 1, x0, y0, x1, y1, fill, pts });
  };
  const disc = (cx: number, cy: number, r: number, fill: string) => ops.push({ k: 2, x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r, fill });
  const W = city.w, H = city.h;
  const e = 0.012;

  rect(0, 0, W, H, C.grass);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = city.tiles[y * W + x] as number;
      if (t === T_FIELD) {
        const patch = hash32(city.seed, ((x >> 2) * 131 + (y >> 2)) | 0);
        rect(x - e, y - e, 1 + 2 * e, 1 + 2 * e, C.fields[(patch >>> 8) % C.fields.length] as string);
        const along = (patch >>> 4) & 1;
        for (let i = 0; i < 3; i++) along ? rect(x + 0.14 + i * 0.33, y, 0.06, 1, C.furrow) : rect(x, y + 0.14 + i * 0.33, 1, 0.06, C.furrow);
      } else if (t === T_LOT) {
        const b = city.buildings[city.lot[y * W + x] as number]!;
        rect(x - e, y - e, 1 + 2 * e, 1 + 2 * e, b.kind === 'house' ? (C.garden[b.variant % 3] as string) : (C.paving[b.district] as string));
      } else if (t === T_GARDEN) {
        rect(x - e, y - e, 1 + 2 * e, 1 + 2 * e, C.garden[hash32(x, y) % 3] as string);
      } else if (t === T_PARK) {
        rect(x - e, y - e, 1 + 2 * e, 1 + 2 * e, C.park);
      } else if (hash01(x * 7 + 1, y) < 0.3 && t === 0) {
        rect(x + 0.1, y + 0.1, 0.8, 0.8, C.grass2);
      }
    }
  // Parcs : allées en croix, bassin, bancs.
  for (const b of city.buildings) {
    if (b.kind !== 'park') continue;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    rect(b.x, cy - 0.16, b.w, 0.32, C.path);
    rect(cx - 0.16, b.y, 0.32, b.h, C.path);
    disc(cx, cy, 0.78, C.path);
    disc(cx, cy, 0.56, C.stone);
    disc(cx, cy, 0.47, C.water);
    disc(cx - 0.1, cy - 0.1, 0.16, C.water2);
    for (const [bx, by] of [[cx - 1.2, cy - 0.3], [cx + 1.0, cy + 0.2], [cx - 0.3, cy + 1.1], [cx + 0.2, cy - 1.25]] as [number, number][])
      if (bx > b.x + 0.2 && bx < b.x + b.w - 0.4 && by > b.y + 0.2 && by < b.y + b.h - 0.3) rect(bx, by, 0.22, 0.08, '#9a7350');
  }
  // Canal.
  rect(city.canalX, 0, city.canalW, H, C.water);
  rect(city.canalX, 0, 0.09, H, C.stone);
  rect(city.canalX + city.canalW - 0.09, 0, 0.09, H, C.stone);
  for (let i = 0; i < H * 3; i++) {
    const rx = city.canalX + 0.3 + hash01(i, 11) * (city.canalW - 0.9);
    rect(rx, (i / 3) + hash01(i, 5) * 0.3, 0.3, 0.035, C.water2);
  }
  // Trottoirs puis chaussées.
  const span = (a: RNode, b: RNode, half: number, pad: number, fill: string) =>
    rect(Math.min(a.x, b.x) + 0.5 - (a.y === b.y ? pad : half), Math.min(a.y, b.y) + 0.5 - (a.y === b.y ? half : pad),
      Math.abs(b.x - a.x) + (a.y === b.y ? 2 * pad : 2 * half), Math.abs(b.y - a.y) + (a.y === b.y ? 2 * half : 2 * pad), fill);
  const segs = city.edges.filter((ed) => ed.dir <= 1);
  for (const ed of segs) span(city.nodes[ed.from]!, city.nodes[ed.to]!, 0.5, 0.5, ed.bridge ? C.stone : C.sidewalk);
  for (const ed of segs) span(city.nodes[ed.from]!, city.nodes[ed.to]!, 0.325, 0.325, C.curb);
  for (const ed of segs) span(city.nodes[ed.from]!, city.nodes[ed.to]!, 0.3, 0.3, C.asphalt);
  for (const ed of segs) {
    if (!ed.bridge) continue;
    const a = city.nodes[ed.from]!, b = city.nodes[ed.to]!;
    rect(a.x + 1, a.y + 0.02, b.x - a.x - 1, 0.05, '#8f897c');
    rect(a.x + 1, a.y + 0.93, b.x - a.x - 1, 0.05, '#8f897c');
  }
  // Marquages : axe central, lignes d'arrêt, passages piétons.
  for (const ed of segs) {
    const a = city.nodes[ed.from]!;
    const big = city.lines[ed.line]!.kind !== 'street';
    const ax = a.x + 0.5, ay = a.y + 0.5;
    const from = 0.5 + (a.deg >= 3 ? 0.42 : 0);
    const to = ed.len + 0.5 - (city.nodes[ed.to]!.deg >= 3 ? 0.42 : 0);
    if (big) {
      for (const o of [-0.022, 0.022])
        ed.dir === 0 ? rect(ax + from, ay + o - 0.009, to - from, 0.018, C.mark) : rect(ax + o - 0.009, ay + from, 0.018, to - from, C.mark);
    } else {
      for (let s = from + 0.08; s + 0.26 < to; s += 0.52)
        ed.dir === 0 ? rect(ax + s, ay - 0.012, 0.26, 0.024, C.mark) : rect(ax - 0.012, ay + s, 0.024, 0.26, C.mark);
    }
  }
  for (const n of city.nodes) {
    if (n.deg < 3) continue;
    const cx = n.x + 0.5, cy = n.y + 0.5;
    for (let d = 0; d < 4; d++) {
      if (n.out[d] === -1) continue;
      const dx = DX[d as Dir], dy = DY[d as Dir];
      // Zébrures.
      for (let i = 0; i < 5; i++) {
        const off = -0.24 + i * 0.12;
        dx !== 0 ? rect(cx + dx * XW_OUT - 0.1, cy + off - 0.035, 0.2, 0.07, C.mark) : rect(cx + off - 0.035, cy + dy * XW_OUT - 0.1, 0.07, 0.2, C.mark);
      }
      // Ligne d'arrêt de la voie entrante : pleine si elle cède le passage ou a un feu.
      const minor = n.control === 'priority' && ((d & 1) as 0 | 1) !== n.major;
      if (n.control === 'lights' || minor) {
        const lx = cx + dx * (0.5 + STOP_BACK + 0.03) + dy * LANE_OFF;
        const ly = cy + dy * (0.5 + STOP_BACK + 0.03) - dx * LANE_OFF;
        if (minor) for (const o of [-0.1, 0, 0.1]) dx !== 0 ? rect(lx - 0.025, ly + o - 0.035, 0.05, 0.07, C.mark) : rect(lx + o - 0.035, ly - 0.025, 0.07, 0.05, C.mark);
        else dx !== 0 ? rect(lx - 0.02, ly - 0.14, 0.04, 0.28, C.mark) : rect(lx - 0.14, ly - 0.02, 0.28, 0.04, C.mark);
      }
    }
  }
  // Ombres portées des bâtiments et des arbres (soleil venant de l'ouest).
  for (const b of city.buildings) {
    if (b.kind === 'park') continue;
    const m = buildingModel(b);
    const hgt = Math.min(m.top, 2.2);
    const vx = hgt * 0.5, vy = -hgt * 0.16;
    const x0 = b.x + 0.1, y0 = b.y + 0.1, x1 = b.x + b.w - 0.1, y1 = b.y + b.h - 0.1;
    poly([x0, y0, x0 + vx, y0 + vy, x1 + vx, y0 + vy, x1 + vx, y1 + vy, x1, y1, x0, y1], C.shadow);
  }
  for (const t of city.trees) disc(t.x + 0.13 * t.size, t.y - 0.03, 0.17 * t.size, 'rgba(35,45,80,0.14)');
  // Noms de rues, peints sur la chaussée.
  for (const ed of segs) {
    if (ed.len < 3) continue;
    const a = city.nodes[ed.from]!;
    const name = city.lines[ed.line]!.name;
    const mx = a.x + 0.5 + DX[ed.dir] * (ed.len / 2 + 0.5);
    const my = a.y + 0.5 + DY[ed.dir] * (ed.len / 2 + 0.5);
    ops.push({ k: 3, x0: mx - 2, y0: my - 2, x1: mx + 2, y1: my + 2, fill: 'rgba(255,252,240,0.5)', text: name, pts: [mx, my], vertical: ed.dir === 1 });
  }
  return ops;
}

function paint(ctx: CanvasRenderingContext2D, ops: Op[], x0: number, y0: number, x1: number, y1: number, texts: boolean): void {
  for (const o of ops) {
    if (o.x1 < x0 || o.x0 > x1 || o.y1 < y0 || o.y0 > y1) continue;
    ctx.fillStyle = o.fill;
    if (o.k === 0) ctx.fillRect(o.x0, o.y0, o.x1 - o.x0, o.y1 - o.y0);
    else if (o.k === 1) {
      const p = o.pts as number[];
      ctx.beginPath();
      ctx.moveTo(p[0] as number, p[1] as number);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i] as number, p[i + 1] as number);
      ctx.fill();
    } else if (o.k === 2) {
      ctx.beginPath();
      ctx.arc((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, (o.x1 - o.x0) / 2, 0, 6.2832);
      ctx.fill();
    } else if (texts) {
      const p = o.pts as number[];
      ctx.save();
      ctx.translate(p[0] as number, p[1] as number);
      if (o.vertical) ctx.rotate(-Math.PI / 2);
      // Sur la voie de droite, lisible depuis le sud.
      ctx.scale(0.01, 0.01);
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(o.text as string, 0, 15.5);
      ctx.restore();
    }
  }
}

export class Ground {
  private ops: Op[];
  private chunks = new Map<string, HTMLCanvasElement>();
  private made = 0;
  constructor(private city: City, private maxChunks: number) {
    this.ops = buildGroundOps(city);
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number): void {
    const need = cam.zoom * dpr;
    const ox = cam.w / 2 - (cam.x - cam.y) * cam.zoom * 0.5;
    const oy = cam.h / 2 - (cam.x + cam.y) * cam.zoom * 0.25;
    if (need > 300) {
      // Dessin direct : peu de tuiles visibles, netteté parfaite.
      const hw = cam.zoom * 0.5, hh = cam.zoom * 0.25;
      ctx.save();
      ctx.transform(hw, hh, -hw, hh, ox, oy);
      const c = [cam.toWorld(0, 0), cam.toWorld(cam.w, 0), cam.toWorld(0, cam.h), cam.toWorld(cam.w, cam.h)];
      paint(ctx, this.ops, Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1])), true);
      ctx.restore();
      return;
    }
    let U = GROUND_BUCKETS[GROUND_BUCKETS.length - 1] as number;
    for (const b of GROUND_BUCKETS) if (b >= need * 0.8) { U = b; break; }
    this.made = 0;
    const pass = (unit: number, force: boolean): boolean => {
      const k = cam.zoom / unit; // pixels CSS par pixel de dalle
      const i0 = Math.floor(-ox / k / CHUNK), i1 = Math.floor((cam.w - ox) / k / CHUNK);
      const j0 = Math.floor(-oy / k / CHUNK), j1 = Math.floor((cam.h - oy) / k / CHUNK);
      let complete = true;
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const c = this.chunk(unit, i, j, force);
          if (c === null) { complete = false; continue; }
          if (c) ctx.drawImage(c, ox + i * CHUNK * k, oy + j * CHUNK * k, CHUNK * k + 0.5, CHUNK * k + 0.5);
        }
      return complete;
    };
    // Si des dalles manquent encore, on affiche d'abord le niveau grossier.
    if (U !== 8 && !this.ready(U, cam, ox, oy)) pass(8, true);
    pass(U, U === 8);
  }

  private ready(unit: number, cam: Camera, ox: number, oy: number): boolean {
    const k = cam.zoom / unit;
    const i0 = Math.floor(-ox / k / CHUNK), i1 = Math.floor((cam.w - ox) / k / CHUNK);
    const j0 = Math.floor(-oy / k / CHUNK), j1 = Math.floor((cam.h - oy) / k / CHUNK);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!this.chunks.has(`${unit}:${i}:${j}`) && !this.empty(unit, i, j)) return false;
    return true;
  }
  /** La dalle tombe-t-elle entièrement hors de la carte ? */
  private empty(unit: number, i: number, j: number): boolean {
    const x0 = i * CHUNK, y0 = j * CHUNK, x1 = x0 + CHUNK, y1 = y0 + CHUNK;
    const W = this.city.w, H = this.city.h;
    return x1 < (-H * unit) / 2 || x0 > (W * unit) / 2 || y1 < 0 || y0 > ((W + H) * unit) / 4;
  }
  /** undefined = hors carte, null = pas encore générée. */
  private chunk(unit: number, i: number, j: number, force: boolean): HTMLCanvasElement | null | undefined {
    if (this.empty(unit, i, j)) return undefined;
    const key = `${unit}:${i}:${j}`;
    let c = this.chunks.get(key);
    if (c) {
      this.chunks.delete(key);
      this.chunks.set(key, c);
      return c;
    }
    if (!force && this.made >= 2) return null;
    this.made++;
    c = document.createElement('canvas');
    c.width = CHUNK;
    c.height = CHUNK;
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    const hw = unit / 2, hh = unit / 4;
    ctx.setTransform(hw, hh, -hw, hh, -i * CHUNK, -j * CHUNK);
    // Boîte monde de la dalle.
    const inv = (sx: number, sy: number): [number, number] => {
      const a = sx / hw, b = sy / hh;
      return [(a + b) / 2, (b - a) / 2];
    };
    const cs = [inv(i * CHUNK, j * CHUNK), inv((i + 1) * CHUNK, j * CHUNK), inv(i * CHUNK, (j + 1) * CHUNK), inv((i + 1) * CHUNK, (j + 1) * CHUNK)];
    paint(ctx, this.ops, Math.min(...cs.map((p) => p[0])), Math.min(...cs.map((p) => p[1])), Math.max(...cs.map((p) => p[0])), Math.max(...cs.map((p) => p[1])), unit >= 64);
    this.chunks.set(key, c);
    if (this.chunks.size > this.maxChunks) {
      for (const k of this.chunks.keys()) {
        if (!k.startsWith('8:')) { this.chunks.delete(k); break; }
      }
    }
    return c;
  }
}

