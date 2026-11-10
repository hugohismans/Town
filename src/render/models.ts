// Modèles vectoriels : chaque bâtiment, arbre ou lampadaire est une liste de
// polygones en coordonnées « unité » (1 = largeur d'une tuile à l'écran).
// Les sprites sont rendus à partir de ces listes, à l'échelle voulue.

import { Rng } from '../sim/rng';
import type { Building } from '../sim/types';
import { mix, shade } from './color';

export const ZS = 0.62; // hauteur écran d'une unité verticale, en largeurs de tuile

export interface Poly {
  pts: number[]; // x0,y0,x1,y1... (ou cx,cy,rx,ry pour une ellipse)
  fill: string;
  ellipse?: boolean;
}

export interface Win {
  pts: number[];
  row: number; // rangée (tranche) du bâtiment
  thr: number; // seuil d'allumage 0..1
  east: boolean;
}

export interface Model {
  polys: Poly[];
  wins: Win[];
  w: number;
  h: number;
  top: number; // hauteur maximale (unités z)
  bx0: number; by0: number; bx1: number; by1: number; // boîte englobante écran
}

const FS = 0.9; // ombrage de la face sud
const FE = 0.72; // ombrage de la face est

const px = (x: number, y: number, z: number): [number, number] => [(x - y) * 0.5, (x + y) * 0.25 - z * ZS];

class MB {
  polys: Poly[] = [];
  wins: Win[] = [];
  top = 0;
  private wi = 0;
  constructor(public seed: number) {}

  poly(p: number[][], fill: string): void {
    const pts: number[] = [];
    for (const q of p) {
      const [sx, sy] = px(q[0] as number, q[1] as number, q[2] as number);
      pts.push(sx, sy);
      if ((q[2] as number) > this.top) this.top = q[2] as number;
    }
    this.polys.push({ pts, fill });
  }
  /** Disque posé à plat ou sphère vue de face (feuillage, parasol). */
  blob(x: number, y: number, z: number, rx: number, ry: number, fill: string): void {
    const [sx, sy] = px(x, y, z);
    this.polys.push({ pts: [sx, sy, rx, ry], fill, ellipse: true });
    if (z + ry / ZS > this.top) this.top = z + ry / ZS;
  }
  flat(x0: number, y0: number, x1: number, y1: number, z: number, fill: string): void {
    this.poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], fill);
  }
  wallS(x0: number, x1: number, y: number, z0: number, z1: number, fill: string): void {
    this.poly([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], shade(fill, FS));
  }
  wallE(x: number, y0: number, y1: number, z0: number, z1: number, fill: string): void {
    this.poly([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], shade(fill, FE));
  }
  box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, wall: string, roof = wall): void {
    this.wallS(x0, x1, y1, z0, z1, wall);
    this.wallE(x1, y0, y1, z0, z1, wall);
    this.flat(x0, y0, x1, y1, z1, roof);
  }
  private win(pts3: number[][], row: number, east: boolean, fill: string): void {
    const pts: number[] = [];
    for (const q of pts3) pts.push(...px(q[0] as number, q[1] as number, q[2] as number));
    this.polys.push({ pts, fill });
    this.wins.push({ pts, row, east, thr: new Rng(this.seed + this.wi++ * 7919).next() });
  }
  winS(x0: number, x1: number, y: number, z0: number, z1: number, row: number, glass: string): void {
    this.win([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], row, false, shade(glass, FS));
  }
  winE(x: number, y0: number, y1: number, z0: number, z1: number, glass: string): void {
    this.win([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], Math.floor((y0 + y1) / 2), true, shade(glass, FE));
  }
  /** Rangées de fenêtres sur les deux faces visibles d'un volume. */
  windows(
    x0: number, y0: number, x1: number, y1: number, zBase: number, floors: number, fh: number,
    o: { glass: string; per?: number; ww?: number; z0?: number; z1?: number; skipS?: number; skipE?: number; sill?: string },
  ): void {
    const per = o.per ?? 0.3;
    const ww = o.ww ?? 0.5;
    const a = o.z0 ?? 0.28;
    const b = o.z1 ?? 0.78;
    const nS = Math.max(1, Math.round((x1 - x0) / per));
    const nE = Math.max(1, Math.round((y1 - y0) / per));
    const row = Math.floor(y1 - 0.001);
    for (let f = 0; f < floors; f++) {
      const z0 = zBase + (f + a) * fh;
      const z1 = zBase + (f + b) * fh;
      for (let i = 0; i < nS; i++) {
        if (f === 0 && o.skipS === i) continue;
        const c = x0 + ((i + 0.5) * (x1 - x0)) / nS;
        const hw = ((x1 - x0) / nS) * ww * 0.5;
        if (o.sill) this.wallS(c - hw - 0.012, c + hw + 0.012, y1, z0 - 0.025, z0, o.sill);
        this.winS(c - hw, c + hw, y1, z0, z1, row, o.glass);
      }
      for (let i = 0; i < nE; i++) {
        if (f === 0 && o.skipE === i) continue;
        const c = y0 + ((i + 0.5) * (y1 - y0)) / nE;
        const hw = ((y1 - y0) / nE) * ww * 0.5;
        if (o.sill) this.wallE(x1, c - hw - 0.012, c + hw + 0.012, z0 - 0.025, z0, o.sill);
        this.winE(x1, c - hw, c + hw, z0, z1, o.glass);
      }
    }
  }
  /** Porte sur la face donnée (1 = sud, 0 = est), centrée en c. */
  door(dir: number, c: number, face: number, z: number, w: number, h: number, fill: string): void {
    if (dir === 1) this.wallS(c - w / 2, c + w / 2, face, z, z + h, fill);
    else if (dir === 0) this.wallE(face, c - w / 2, c + w / 2, z, z + h, fill);
  }
  /** Toit à deux pentes. axis 0 : faîtage le long de x. */
  gable(x0: number, y0: number, x1: number, y1: number, zw: number, zr: number, axis: number, wall: string, roof: string): void {
    const o = 0.04;
    if (axis === 0) {
      const ym = (y0 + y1) / 2;
      this.poly([[x0 - o, y0 - o, zw - 0.02], [x1 + o, y0 - o, zw - 0.02], [x1 + o, ym, zr], [x0 - o, ym, zr]], shade(roof, 1.08));
      this.poly([[x1, y0, zw], [x1, y1, zw], [x1, ym, zr]], shade(wall, FE));
      this.poly([[x0 - o, ym, zr], [x1 + o, ym, zr], [x1 + o, y1 + o, zw - 0.03], [x0 - o, y1 + o, zw - 0.03]], shade(roof, 0.92));
    } else {
      const xm = (x0 + x1) / 2;
      this.poly([[x0 - o, y0 - o, zw - 0.02], [xm, y0 - o, zr], [xm, y1 + o, zr], [x0 - o, y1 + o, zw - 0.02]], shade(roof, 1.08));
      this.poly([[x0, y1, zw], [x1, y1, zw], [xm, y1, zr]], shade(wall, FS));
      this.poly([[xm, y0 - o, zr], [x1 + o, y0 - o, zw - 0.03], [x1 + o, y1 + o, zw - 0.03], [xm, y1 + o, zr]], shade(roof, 0.78));
    }
  }
  tree(x: number, y: number, s: number, kind: number, seed: number): void {
    const r = new Rng(seed);
    const greens = ['#6fae5a', '#5d9f58', '#7fb964', '#4f9462', '#8cbf5e'];
    let g = r.pick(greens);
    if (r.chance(0.07)) g = r.pick(['#e8a7b9', '#e3b04b', '#d98d4a']);
    this.poly([[x - 0.02, y + 0.02, 0], [x + 0.02, y - 0.02, 0], [x + 0.02, y - 0.02, 0.2 * s], [x - 0.02, y + 0.02, 0.2 * s]], '#7a5a44');
    if (kind === 1) {
      this.blob(x, y, 0.42 * s, 0.1 * s, 0.24 * s, shade(g, 0.86));
      this.blob(x - 0.015, y, 0.46 * s, 0.075 * s, 0.19 * s, g);
    } else if (kind === 2) {
      const d = shade(mix(g, '#3f7f6a', 0.5), 0.9);
      for (let i = 0; i < 3; i++) {
        const z = (0.14 + i * 0.15) * s;
        const w = (0.17 - i * 0.04) * s;
        const [cx, cy] = px(x, y, z);
        const [, ty] = px(x, y, z + 0.24 * s);
        this.polys.push({ pts: [cx - w, cy, cx + w, cy, cx, ty], fill: shade(d, 1 + i * 0.07) });
      }
      if (0.7 * s > this.top) this.top = 0.7 * s;
    } else {
      this.blob(x + 0.02, y, 0.3 * s, 0.17 * s, 0.14 * s, shade(g, 0.8));
      this.blob(x - 0.03, y, 0.36 * s, 0.15 * s, 0.13 * s, g);
      if (kind === 3) this.blob(x + 0.06, y, 0.4 * s, 0.1 * s, 0.09 * s, shade(g, 0.93));
      this.blob(x - 0.06, y, 0.41 * s, 0.07 * s, 0.06 * s, shade(g, 1.12));
    }
  }
  done(w: number, h: number): Model {
    let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
    for (const p of this.polys) {
      if (p.ellipse) {
        const [cx, cy, rx, ry] = p.pts as [number, number, number, number];
        bx0 = Math.min(bx0, cx - rx); bx1 = Math.max(bx1, cx + rx);
        by0 = Math.min(by0, cy - ry); by1 = Math.max(by1, cy + ry);
        continue;
      }
      for (let i = 0; i < p.pts.length; i += 2) {
        const x = p.pts[i] as number;
        const y = p.pts[i + 1] as number;
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
    return { polys: this.polys, wins: this.wins, w, h, top: this.top, bx0, by0, bx1, by1 };
  }
}

const HOUSE_WALLS = ['#f6ead2', '#f3d9b8', '#f7e3a8', '#dbe7ee', '#f0d0c9', '#dbe5c6', '#f7f3ea', '#ead2b0', '#f2c9a0'];
const ROOFS = ['#c96a4b', '#b8573f', '#d0825a', '#6d7684', '#8b5b46', '#5a8a8b', '#a54f3e', '#c7774f'];
const APT_WALLS = ['#efe3cc', '#e8c9a0', '#e6b89c', '#dccbb4', '#f1ead9', '#d9b48c', '#e3d6c2', '#cdd6d8', '#e9c3b0'];
const GLASS = '#86a9bd';
const OFFICE_GLASS = ['#9fc4d8', '#a8cdd0', '#8fb4cf', '#b4c9d6', '#9ad0c2'];
const OFFICE_FRAME = ['#f2f2ee', '#dedcd4', '#cbd2d7', '#ebe3d4', '#d5c9b8'];
const AWNINGS = ['#d9534f', '#3f8f6b', '#e2a03f', '#4a7fb5', '#b05a8c', '#d97b3d', '#5c6bc0'];
const DOORS = ['#7a4b35', '#4f6b5a', '#3f5a78', '#8c3b3b', '#5b4636'];
const FH = 0.36; // hauteur d'un étage

function awning(m: MB, b: Building, x0: number, y0: number, x1: number, y1: number, z: number, color: string): void {
  const d = 0.11;
  if (b.doorDir === 1) {
    const n = Math.max(2, Math.round((x1 - x0) / 0.12));
    for (let i = 0; i < n; i++) {
      const a = x0 + ((x1 - x0) * i) / n;
      const c = x0 + ((x1 - x0) * (i + 1)) / n;
      m.poly([[a, y1, z], [c, y1, z], [c, y1 + d, z - 0.07], [a, y1 + d, z - 0.07]], i % 2 ? '#f7f1e3' : color);
    }
    m.poly([[x0, y1 + d, z - 0.07], [x1, y1 + d, z - 0.07], [x1, y1 + d, z - 0.1], [x0, y1 + d, z - 0.1]], shade(color, 0.8));
  } else if (b.doorDir === 0) {
    const n = Math.max(2, Math.round((y1 - y0) / 0.12));
    for (let i = 0; i < n; i++) {
      const a = y0 + ((y1 - y0) * i) / n;
      const c = y0 + ((y1 - y0) * (i + 1)) / n;
      m.poly([[x1, a, z], [x1, c, z], [x1 + d, c, z - 0.07], [x1 + d, a, z - 0.07]], i % 2 ? '#efe8d8' : shade(color, 0.85));
    }
    m.poly([[x1 + d, y0, z - 0.07], [x1 + d, y1, z - 0.07], [x1 + d, y1, z - 0.1], [x1 + d, y0, z - 0.1]], shade(color, 0.65));
  }
}

function roofStuff(m: MB, r: Rng, x0: number, y0: number, x1: number, y1: number, z: number, big: boolean): void {
  const n = big ? r.between(2, 3) : r.between(0, 2);
  for (let i = 0; i < n; i++) {
    const w = r.range(0.1, 0.2);
    const d = r.range(0.1, 0.18);
    const x = r.range(x0 + 0.08, x1 - 0.08 - w);
    const y = r.range(y0 + 0.08, y1 - 0.08 - d);
    m.box(x, y, x + w, y + d, z, z + r.range(0.05, 0.12), r.pick(['#cfd3d6', '#b9bec2', '#d8d2c4']));
  }
}

function house(m: MB, b: Building, r: Rng): void {
  const wall = r.pick(HOUSE_WALLS);
  const roof = r.pick(ROOFS);
  // Sur un grand terrain, la maison tient sur une tuile et laisse un jardin.
  let x0 = 0.15, y0 = 0.15, x1 = b.w - 0.15, y1 = b.h - 0.15;
  if (b.w === 2) { if (b.doorDir === 0 || (b.doorDir !== 2 && r.chance(0.5))) x0 = 0.85; else x1 = 1.15; }
  if (b.h === 2) { if (b.doorDir === 1 || (b.doorDir !== 3 && r.chance(0.5))) y0 = 0.85; else y1 = 1.15; }
  const zw = 0.08 + b.floors * 0.3;
  const axis = x1 - x0 > y1 - y0 + 0.01 ? 0 : y1 - y0 > x1 - x0 + 0.01 ? 1 : r.int(2);
  const rise = r.range(0.2, 0.28);
  // Jardin : haie et arbre.
  const garden = b.w * b.h === 2;
  const gx = x0 > 0.5 ? 0.42 : b.w === 2 ? 1.6 : 0.5;
  const gy = y0 > 0.5 ? 0.42 : b.h === 2 ? 1.6 : 0.5;
  const treeBehind = gx + gy < x0 + y0;
  const treeSize = r.range(0.8, 1.05);
  const treeKind = r.int(4);
  if (garden && treeBehind) m.tree(gx, gy, treeSize, treeKind, b.variant + 3);
  m.wallS(x0, x1, y1, 0, zw, wall);
  m.wallE(x1, y0, y1, 0, zw, wall);
  const doorI = r.int(2);
  m.windows(x0, y0, x1, y1, 0.06, b.floors, 0.3, {
    glass: GLASS, per: 0.34, ww: 0.42, z0: 0.3, z1: 0.82, sill: '#fbf7ee',
    skipS: b.doorDir === 1 ? doorI : undefined, skipE: b.doorDir === 0 ? doorI : undefined,
  });
  const nS = Math.max(1, Math.round((x1 - x0) / 0.34));
  const nE = Math.max(1, Math.round((y1 - y0) / 0.34));
  if (b.doorDir === 1) m.door(1, x0 + ((Math.min(doorI, nS - 1) + 0.5) * (x1 - x0)) / nS, y1, 0, 0.12, 0.24, r.pick(DOORS));
  if (b.doorDir === 0) m.door(0, y0 + ((Math.min(doorI, nE - 1) + 0.5) * (y1 - y0)) / nE, x1, 0, 0.12, 0.24, r.pick(DOORS));
  m.gable(x0, y0, x1, y1, zw, zw + rise, axis, wall, roof);
  // Cheminée.
  const cx = axis === 0 ? x0 + (x1 - x0) * r.range(0.2, 0.8) : (x0 + x1) / 2 + 0.1;
  const cy = axis === 0 ? (y0 + y1) / 2 + 0.1 : y0 + (y1 - y0) * r.range(0.2, 0.8);
  m.box(cx - 0.035, cy - 0.035, cx + 0.035, cy + 0.035, zw + rise * 0.45, zw + rise + 0.07, '#b9a08c', '#8d7b6c');
  if (garden && !treeBehind) m.tree(gx, gy, treeSize, treeKind, b.variant + 3);
}

function apartment(m: MB, b: Building, r: Rng): void {
  const wall = r.pick(APT_WALLS);
  const i = 0.07;
  const x0 = i, y0 = i, x1 = b.w - i, y1 = b.h - i;
  const mansard = r.chance(0.55);
  const floors = mansard ? b.floors - 1 : b.floors;
  const z1 = 0.06 + floors * FH;
  m.wallS(x0, x1, y1, 0, z1, wall);
  m.wallE(x1, y0, y1, 0, z1, wall);
  // Soubassement et bandeaux d'étage.
  m.wallS(x0, x1, y1, 0, 0.07, shade(wall, 0.84));
  m.wallE(x1, y0, y1, 0, 0.07, shade(wall, 0.84));
  for (let f = 1; f < floors; f++) {
    const z = 0.06 + f * FH;
    m.wallS(x0, x1, y1, z - 0.012, z + 0.012, shade(wall, 1.07));
    m.wallE(x1, y0, y1, z - 0.012, z + 0.012, shade(wall, 1.07));
  }
  const nS = Math.max(1, Math.round((x1 - x0) / 0.3));
  const nE = Math.max(1, Math.round((y1 - y0) / 0.3));
  const dS = nS >> 1, dE = nE >> 1;
  m.windows(x0, y0, x1, y1, 0.06, floors, FH, {
    glass: GLASS, per: 0.3, ww: 0.46, z0: 0.24, z1: 0.8, sill: r.chance(0.5) ? '#4a4f57' : '#fbf7ee',
    skipS: b.doorDir === 1 ? dS : undefined, skipE: b.doorDir === 0 ? dE : undefined,
  });
  if (b.doorDir === 1) m.door(1, x0 + ((dS + 0.5) * (x1 - x0)) / nS, y1, 0, 0.14, 0.28, r.pick(DOORS));
  if (b.doorDir === 0) m.door(0, y0 + ((dE + 0.5) * (y1 - y0)) / nE, x1, 0, 0.14, 0.28, r.pick(DOORS));
  if (mansard) {
    const slate = r.pick(['#6d7684', '#5f6875', '#7a7f8c', '#8b5b46']);
    const o = 0.05;
    m.flat(x0, y0, x1, y1, z1, shade(wall, 1.05));
    const zt = z1 + FH * 0.85;
    m.poly([[x0, y1, z1], [x1, y1, z1], [x1 - o, y1 - o, zt], [x0 + o, y1 - o, zt]], shade(slate, FS));
    m.poly([[x1, y0, z1], [x1, y1, z1], [x1 - o, y1 - o, zt], [x1 - o, y0 + o, zt]], shade(slate, FE));
    m.flat(x0 + o, y0 + o, x1 - o, y1 - o, zt, shade(slate, 1.12));
    // Lucarnes.
    for (let k = 0; k < nS; k++) {
      const c = x0 + ((k + 0.5) * (x1 - x0)) / nS;
      m.winS(c - 0.05, c + 0.05, y1 - 0.025, z1 + 0.07, z1 + 0.22, Math.floor(y1 - 0.001), '#a9c6d4');
    }
    for (let k = 0; k < nE; k++) {
      const c = y0 + ((k + 0.5) * (y1 - y0)) / nE;
      m.winE(x1 - 0.025, c - 0.05, c + 0.05, z1 + 0.07, z1 + 0.22, '#a9c6d4');
    }
    roofStuff(m, r, x0 + o, y0 + o, x1 - o, y1 - o, zt, false);
  } else {
    m.flat(x0, y0, x1, y1, z1, shade(wall, 1.04));
    m.flat(x0 + 0.04, y0 + 0.04, x1 - 0.04, y1 - 0.04, z1, '#b9b3a6');
    roofStuff(m, r, x0, y0, x1, y1, z1, b.w * b.h > 2);
  }
}

function office(m: MB, b: Building, r: Rng): void {
  const glass = r.pick(OFFICE_GLASS);
  const frame = r.pick(OFFICE_FRAME);
  const i = 0.06;
  const x0 = i, y0 = i, x1 = b.w - i, y1 = b.h - i;
  const lobby = 0.42;
  const z1 = lobby + (b.floors - 1) * FH;
  m.wallS(x0, x1, y1, 0, z1, frame);
  m.wallE(x1, y0, y1, 0, z1, frame);
  // Rez-de-chaussée vitré.
  m.winS(x0 + 0.05, x1 - 0.05, y1, 0.04, lobby - 0.08, Math.floor(y1 - 0.001), shade(glass, 0.9));
  m.winE(x1, y0 + 0.05, y1 - 0.05, 0.04, lobby - 0.08, shade(glass, 0.9));
  if (b.doorDir === 1) m.door(1, (x0 + x1) / 2, y1, 0, 0.16, lobby - 0.1, '#3d4a57');
  if (b.doorDir === 0) m.door(0, (y0 + y1) / 2, x1, 0, 0.16, lobby - 0.1, '#3d4a57');
  const bands = r.chance(0.5);
  m.windows(x0, y0, x1, y1, lobby, b.floors - 1, FH, {
    glass, per: bands ? 0.24 : 0.19, ww: bands ? 0.9 : 0.7, z0: 0.2, z1: 0.82,
  });
  m.flat(x0, y0, x1, y1, z1, shade(frame, 1.03));
  m.flat(x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 0.05, z1, '#aeb4b8');
  roofStuff(m, r, x0, y0, x1, y1, z1, true);
  if (b.floors >= 6) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    m.box(cx - 0.18, cy - 0.18, cx + 0.18, cy + 0.18, z1, z1 + 0.16, frame, '#c2c7ca');
    m.poly([[cx - 0.008, cy, z1 + 0.16], [cx + 0.008, cy, z1 + 0.16], [cx + 0.008, cy, z1 + 0.6], [cx - 0.008, cy, z1 + 0.6]], '#8a8f94');
  }
}

function shopLike(m: MB, b: Building, r: Rng): void {
  const wall = r.pick(b.kind === 'bar' ? ['#5e4a5c', '#3f4d5e', '#6b4a3f'] : APT_WALLS);
  const color = AWNINGS[(b.variant >>> 5) % AWNINGS.length] as string;
  const terrace = b.kind === 'cafe' || b.kind === 'restaurant';
  let x0 = 0.07, y0 = 0.07, x1 = b.w - 0.07, y1 = b.h - 0.07;
  if (terrace && b.doorDir === 1) y1 = b.h - 0.3;
  if (terrace && b.doorDir === 0) x1 = b.w - 0.3;
  const zg = 0.4;
  const z1 = zg + (b.floors - 1) * FH;
  m.wallS(x0, x1, y1, 0, z1, wall);
  m.wallE(x1, y0, y1, 0, z1, wall);
  const front = b.kind === 'bar' ? '#2f3944' : shade(color, 0.75);
  const vit = b.kind === 'bar' ? '#c9a45c' : '#a9c6d4';
  const row = Math.floor(y1 - 0.001);
  if (b.doorDir === 1) {
    m.wallS(x0 + 0.03, x1 - 0.03, y1, 0, zg - 0.04, front);
    m.winS(x0 + 0.07, x0 + (x1 - x0) * 0.58, y1, 0.09, zg - 0.1, row, vit);
    m.door(1, x0 + (x1 - x0) * 0.78, y1, 0, 0.13, 0.27, '#3b332e');
  } else if (b.doorDir === 0) {
    m.wallE(x1, y0 + 0.03, y1 - 0.03, 0, zg - 0.04, front);
    m.winE(x1, y0 + 0.07, y0 + (y1 - y0) * 0.58, 0.09, zg - 0.1, vit);
    m.door(0, y0 + (y1 - y0) * 0.78, x1, 0, 0.13, 0.27, '#3b332e');
  } else {
    m.windows(x0, y0, x1, y1, 0.02, 1, zg, { glass: GLASS, per: 0.4, ww: 0.5 });
  }
  if (b.floors > 1) m.windows(x0, y0, x1, y1, zg, b.floors - 1, FH, { glass: GLASS, per: 0.3, ww: 0.44, z0: 0.24, z1: 0.8, sill: '#fbf7ee' });
  if (b.kind !== 'bar') awning(m, b, x0 + 0.03, y0 + 0.03, x1 - 0.03, y1 - 0.03, zg + 0.02, color);
  else {
    // Enseigne lumineuse du bar.
    if (b.doorDir === 1) m.winS(x0 + 0.15, x1 - 0.15, y1, zg - 0.03, zg + 0.05, row, '#e8b04a');
    if (b.doorDir === 0) m.winE(x1, y0 + 0.15, y1 - 0.15, zg - 0.03, zg + 0.05, '#e8b04a');
  }
  if (r.chance(0.5)) {
    m.flat(x0, y0, x1, y1, z1, shade(wall, 1.04));
    m.flat(x0 + 0.04, y0 + 0.04, x1 - 0.04, y1 - 0.04, z1, '#b9b3a6');
    roofStuff(m, r, x0, y0, x1, y1, z1, false);
  } else {
    m.gable(x0, y0, x1, y1, z1, z1 + 0.18, b.doorDir === 0 ? 1 : 0, wall, r.pick(ROOFS));
  }
  if (terrace) {
    // Terrasse : tables et parasols.
    const umb = [color, '#f7f1e3'];
    for (let k = 0; k < 2; k++) {
      const t = 0.25 + k * 0.5;
      const tx = b.doorDir === 0 ? b.w - 0.14 : x0 + (x1 - x0) * t;
      const ty = b.doorDir === 1 ? b.h - 0.14 : y0 + (y1 - y0) * t;
      if (b.doorDir !== 0 && b.doorDir !== 1) break;
      m.blob(tx, ty, 0.07, 0.06, 0.03, '#e9e2d2');
      m.poly([[tx - 0.006, ty, 0.07], [tx + 0.006, ty, 0.07], [tx + 0.006, ty, 0.24], [tx - 0.006, ty, 0.24]], '#8a8072');
      m.blob(tx, ty, 0.25, 0.1, 0.05, umb[k % 2] as string);
      m.blob(tx, ty, 0.275, 0.05, 0.022, shade(umb[k % 2] as string, 1.1));
    }
  }
}

function hospital(m: MB, b: Building, _r: Rng): void {
  const wall = '#f4f3ee';
  const x1 = b.w - 0.08, y1 = b.h - 0.08;
  // Aile basse devant, bloc principal derrière.
  const zMain = 0.06 + 4 * FH;
  const split = b.w > 2 ? b.w - 1.1 : b.w * 0.55;
  m.wallS(0.08, split, y1, 0, zMain, wall);
  m.wallE(split, 0.08, y1, 0, zMain, wall);
  m.windows(0.08, 0.08, split, y1, 0.06, 4, FH, { glass: '#8fb9cf', per: 0.27, ww: 0.6, z0: 0.24, z1: 0.76 });
  m.flat(0.08, 0.08, split, y1, zMain, '#fbfaf6');
  m.flat(0.14, 0.14, split - 0.06, y1 - 0.06, zMain, '#c8cdd0');
  // Hélisurface.
  const [hx, hy] = [(0.08 + split) / 2, (0.08 + y1) / 2];
  m.blob(hx, hy, zMain, 0.3, 0.15, '#7d8790');
  m.blob(hx, hy, zMain, 0.25, 0.125, '#96a0a8');
  m.flat(hx - 0.13, hy - 0.03, hx + 0.13, hy + 0.03, zMain, '#f4f3ee');
  m.flat(hx - 0.13, hy - 0.13, hx - 0.08, hy + 0.13, zMain, '#f4f3ee');
  m.flat(hx + 0.08, hy - 0.13, hx + 0.13, hy + 0.13, zMain, '#f4f3ee');
  const zWing = 0.06 + 2 * FH;
  m.wallS(split, x1, y1, 0, zWing, '#ebe9e2');
  m.wallE(x1, 0.3, y1, 0, zWing, '#ebe9e2');
  m.windows(split, 0.3, x1, y1, 0.06, 2, FH, { glass: '#8fb9cf', per: 0.27, ww: 0.6, z0: 0.24, z1: 0.76, skipS: b.doorDir === 1 ? 1 : undefined, skipE: b.doorDir === 0 ? 1 : undefined });
  m.flat(split, 0.3, x1, y1, zWing, '#f6f5f0');
  // Croix rouge.
  const cx = (split + x1) / 2, cy = (0.3 + y1) / 2;
  m.flat(cx - 0.2, cy - 0.065, cx + 0.2, cy + 0.065, zWing, '#d9534f');
  m.flat(cx - 0.065, cy - 0.2, cx + 0.065, cy + 0.2, zWing, '#d9534f');
  // Entrée des urgences.
  if (b.doorDir === 1) {
    m.door(1, split + (x1 - split) * 0.5, y1, 0, 0.26, 0.26, '#5e7f93');
    m.poly([[split + 0.1, y1, 0.3], [x1 - 0.1, y1, 0.3], [x1 - 0.1, y1 + 0.07, 0.29], [split + 0.1, y1 + 0.07, 0.29]], '#d9534f');
  } else if (b.doorDir === 0) {
    m.door(0, 0.3 + (y1 - 0.3) * 0.5, x1, 0, 0.26, 0.26, '#5e7f93');
    m.poly([[x1, 0.4, 0.3], [x1, y1 - 0.1, 0.3], [x1 + 0.07, y1 - 0.1, 0.29], [x1 + 0.07, 0.4, 0.29]], '#c24a46');
  }
}

function school(m: MB, b: Building, r: Rng): void {
  const wall = r.pick(['#d98a6a', '#cf7f62', '#e0a070']);
  const x0 = 0.08, y0 = 0.08, x1 = b.w - 0.08, y1 = b.h - 0.38;
  const z1 = 0.06 + 2 * FH;
  // Cour de récréation devant.
  m.flat(0.06, y1, b.w - 0.06, b.h - 0.05, 0.004, '#d8c9a8');
  m.wallS(x0, x1, y1, 0, z1, wall);
  m.wallE(x1, y0, y1, 0, z1, wall);
  m.windows(x0, y0, x1, y1, 0.06, 2, FH, { glass: '#a9c6d4', per: 0.3, ww: 0.62, z0: 0.22, z1: 0.8, sill: '#fbf7ee', skipS: b.doorDir === 1 ? Math.round((x1 - x0) / 0.3) >> 1 : undefined });
  if (b.doorDir === 1) m.door(1, x0 + ((((Math.round((x1 - x0) / 0.3) >> 1) + 0.5) * (x1 - x0)) / Math.round((x1 - x0) / 0.3)), y1, 0, 0.16, 0.28, '#4f6b5a');
  if (b.doorDir === 0) m.door(0, (y0 + y1) / 2, x1, 0, 0.16, 0.28, '#4f6b5a');
  m.gable(x0, y0, x1, y1, z1, z1 + 0.22, 0, wall, '#8b5b46');
  // Horloge et clocheton.
  const cx = (x0 + x1) / 2;
  m.box(cx - 0.1, (y0 + y1) / 2 - 0.1, cx + 0.1, (y0 + y1) / 2 + 0.1, z1 + 0.1, z1 + 0.42, '#f6ead2', '#8b5b46');
  const [kx, ky] = px(cx, (y0 + y1) / 2 + 0.1, z1 + 0.32);
  m.polys.push({ pts: [kx, ky, 0.04, 0.04], fill: '#fffdf5', ellipse: true });
  // Arbre de la cour et marelle.
  m.tree(0.4, b.h - 0.2, 0.9, 0, b.variant);
  m.flat(b.w - 0.9, b.h - 0.28, b.w - 0.5, b.h - 0.16, 0.006, '#f3e7cc');
}

function townhall(m: MB, b: Building, _r: Rng): void {
  const wall = '#eadfc8';
  const x0 = 0.1, y0 = 0.1, x1 = b.w - 0.1, y1 = b.h - 0.14;
  const z1 = 0.1 + 2 * 0.4;
  m.wallS(x0, x1, y1, 0, z1, wall);
  m.wallE(x1, y0, y1, 0, z1, wall);
  m.wallS(x0 - 0.03, x1 + 0.03, y1 + 0.03, 0, 0.08, '#d6cab2');
  m.wallE(x1 + 0.03, y0, y1 + 0.03, 0, 0.08, '#d6cab2');
  m.windows(x0, y0, x1, y1, 0.1, 2, 0.4, { glass: '#8fb0c2', per: 0.3, ww: 0.42, z0: 0.2, z1: 0.82, sill: '#fbf7ee', skipS: b.doorDir === 1 ? Math.round((x1 - x0) / 0.3) >> 1 : undefined, skipE: b.doorDir === 0 ? Math.round((y1 - y0) / 0.3) >> 1 : undefined });
  const nS = Math.round((x1 - x0) / 0.3), nE = Math.round((y1 - y0) / 0.3);
  if (b.doorDir === 1) m.door(1, x0 + (((nS >> 1) + 0.5) * (x1 - x0)) / nS, y1, 0.04, 0.17, 0.34, '#6b4a35');
  if (b.doorDir === 0) m.door(0, y0 + (((nE >> 1) + 0.5) * (y1 - y0)) / nE, x1, 0.04, 0.17, 0.34, '#6b4a35');
  // Toit d'ardoise à quatre pans.
  const o = 0.2, zt = z1 + 0.26;
  m.poly([[x0, y1, z1], [x1, y1, z1], [x1 - o, y1 - o, zt], [x0 + o, y1 - o, zt]], shade('#66707d', FS));
  m.poly([[x1, y0, z1], [x1, y1, z1], [x1 - o, y1 - o, zt], [x1 - o, y0 + o, zt]], shade('#66707d', FE));
  m.flat(x0 + o, y0 + o, x1 - o, y1 - o, zt, '#7a8592');
  // Beffroi.
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  m.box(cx - 0.14, cy - 0.14, cx + 0.14, cy + 0.14, zt, zt + 0.42, '#f1e7d2', '#66707d');
  const [kx, ky] = px(cx, cy + 0.14, zt + 0.28);
  m.polys.push({ pts: [kx, ky, 0.05, 0.05], fill: '#fffdf5', ellipse: true });
  const [k2x, k2y] = px(cx + 0.14, cy, zt + 0.28);
  m.polys.push({ pts: [k2x, k2y, 0.04, 0.05], fill: '#e3dccb', ellipse: true });
  m.poly([[cx - 0.14, cy + 0.14, zt + 0.42], [cx + 0.14, cy + 0.14, zt + 0.42], [cx, cy, zt + 0.74]], shade('#66707d', FS));
  m.poly([[cx + 0.14, cy - 0.14, zt + 0.42], [cx + 0.14, cy + 0.14, zt + 0.42], [cx, cy, zt + 0.74]], shade('#66707d', FE));
  // Drapeau tricolore.
  const fz = zt + 0.74;
  m.poly([[cx - 0.006, cy, fz], [cx + 0.006, cy, fz], [cx + 0.006, cy, fz + 0.2], [cx - 0.006, cy, fz + 0.2]], '#8a8f94');
  ['#3d5a9e', '#f7f3ea', '#d9534f'].forEach((c, k) => m.poly([[cx + k * 0.05, cy, fz + 0.1], [cx + (k + 1) * 0.05, cy, fz + 0.1], [cx + (k + 1) * 0.05, cy, fz + 0.2], [cx + k * 0.05, cy, fz + 0.2]], c));
}

function cinema(m: MB, b: Building, r: Rng): void {
  const wall = r.pick(['#7c4a5e', '#3f5876', '#8a4b3f']);
  const x0 = 0.07, y0 = 0.07, x1 = b.w - 0.07, y1 = b.h - 0.07;
  const z1 = 0.95;
  m.wallS(x0, x1, y1, 0, z1, wall);
  m.wallE(x1, y0, y1, 0, z1, wall);
  const row = Math.floor(y1 - 0.001);
  if (b.doorDir === 0) {
    m.winE(x1, y0 + 0.2, y1 - 0.2, 0.04, 0.3, '#f2d9a0');
    m.poly([[x1, y0 + 0.1, 0.36], [x1, y1 - 0.1, 0.36], [x1 + 0.12, y1 - 0.1, 0.36], [x1 + 0.12, y0 + 0.1, 0.36]], '#f1e3bf');
    m.wallE(x1 + 0.12, y0 + 0.1, y1 - 0.1, 0.36, 0.5, '#f7edd0');
    for (let k = 0; k < 6; k++) m.winE(x1 + 0.121, y0 + 0.16 + k * ((y1 - y0 - 0.3) / 6), y0 + 0.2 + k * ((y1 - y0 - 0.3) / 6), 0.4, 0.46, '#e2a03f');
  } else {
    if (b.doorDir === 1) m.winS(x0 + 0.2, x1 - 0.2, y1, 0.04, 0.3, row, '#f2d9a0');
    m.poly([[x0 + 0.1, y1, 0.36], [x1 - 0.1, y1, 0.36], [x1 - 0.1, y1 + 0.12, 0.36], [x0 + 0.1, y1 + 0.12, 0.36]], '#f1e3bf');
    m.wallS(x0 + 0.1, x1 - 0.1, y1 + 0.12, 0.36, 0.5, '#f7edd0');
    for (let k = 0; k < 6; k++) m.winS(x0 + 0.16 + k * ((x1 - x0 - 0.3) / 6), x0 + 0.2 + k * ((x1 - x0 - 0.3) / 6), y1 + 0.121, 0.4, 0.46, row, '#e2a03f');
  }
  m.flat(x0, y0, x1, y1, z1, shade(wall, 1.1));
  m.box(x0 + 0.3, y0 + 0.2, x1 - 0.2, y1 - 0.3, z1, z1 + 0.25, shade(wall, 0.92), shade(wall, 1.05));
}

function garage(m: MB, b: Building, _r: Rng): void {
  const wall = '#d7d3c8';
  const x0 = 0.08, y0 = 0.08, x1 = b.w - 0.08, y1 = b.h - 0.12;
  const z1 = 0.5;
  m.wallS(x0, x1, y1, 0, z1, wall);
  m.wallE(x1, y0, y1, 0, z1, wall);
  const n = Math.max(1, Math.round((b.doorDir === 0 ? y1 - y0 : x1 - x0) / 0.42));
  for (let k = 0; k < n; k++) {
    const t0 = (k + 0.14) / n, t1 = (k + 0.86) / n;
    if (b.doorDir === 0) m.winE(x1, y0 + (y1 - y0) * t0, y0 + (y1 - y0) * t1, 0, 0.34, k === 0 ? '#3a4149' : '#59636d');
    else m.winS(x0 + (x1 - x0) * t0, x0 + (x1 - x0) * t1, y1, 0, 0.34, Math.floor(y1 - 0.001), k === 0 ? '#3a4149' : '#59636d');
  }
  m.wallS(x0, x1, y1, z1 - 0.1, z1, '#e2a03f');
  m.wallE(x1, y0, y1, z1 - 0.1, z1, '#e2a03f');
  m.flat(x0, y0, x1, y1, z1, '#c4c8cb');
  m.flat(x0 + 0.05, y0 + 0.05, x1 - 0.05, y1 - 0.05, z1, '#aab0b5');
}

const modelCache = new Map<number, Model>();

export function buildingModel(b: Building): Model {
  let model = modelCache.get(b.id);
  if (model) return model;
  const m = new MB(b.variant);
  const r = new Rng(b.variant ^ 0x1234);
  switch (b.kind) {
    case 'house': house(m, b, r); break;
    case 'apartment': apartment(m, b, r); break;
    case 'office': office(m, b, r); break;
    case 'hospital': hospital(m, b, r); break;
    case 'school': school(m, b, r); break;
    case 'townhall': townhall(m, b, r); break;
    case 'cinema': cinema(m, b, r); break;
    case 'garage': garage(m, b, r); break;
    case 'park': break;
    default: shopLike(m, b, r);
  }
  model = m.done(b.w, b.h);
  modelCache.set(b.id, model);
  return model;
}

export function clearModelCache(): void {
  modelCache.clear();
  treeCache.clear();
}

const treeCache = new Map<number, Model>();
/** Arbre isolé : 4 essences x 6 teintes, origine au pied du tronc. */
export function treeModel(kind: number, tone: number): Model {
  const key = kind * 16 + tone;
  let model = treeCache.get(key);
  if (!model) {
    const m = new MB(key);
    m.tree(0, 0, 1, kind, key * 31 + 7);
    model = m.done(1, 1);
    treeCache.set(key, model);
  }
  return model;
}

let lampCache: Model | null = null;
export function lampModel(): Model {
  if (!lampCache) {
    const m = new MB(1);
    m.poly([[-0.012, 0.012, 0], [0.012, -0.012, 0], [0.012, -0.012, 0.44], [-0.012, 0.012, 0.44]], '#4d545c');
    m.blob(0, 0, 0.46, 0.035, 0.02, '#3d444b');
    m.blob(0, 0, 0.445, 0.022, 0.012, '#fff3c4');
    lampCache = m.done(1, 1);
  }
  return lampCache;
}
