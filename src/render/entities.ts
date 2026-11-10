// Dessin vectoriel des habitants et des véhicules.

import type { Car, Person } from '../sim/types';
import { shade } from './color';
import { tint, type Daylight } from './daylight';
import { ZS } from './models';

const SKIN = ['#f6d7b8', '#eec39a', '#d9a273', '#b9794c', '#8d5a3b', '#f2cfae'];
const HAIR = ['#2f2620', '#5a3b22', '#8a5a2e', '#c9993f', '#b5532f', '#1f1f24', '#6d4a3a'];
const TOPS = ['#d9534f', '#3f8f6b', '#e2a03f', '#4a7fb5', '#b05a8c', '#5c6bc0', '#e07b53', '#3aa6a0', '#8d6e63', '#f2f0e6', '#546e7a', '#c0ca33'];
const BOTTOMS = ['#3d4a5c', '#5a5148', '#2f3b46', '#6b7a8a', '#7a5a44', '#44546a'];
export const CAR_COLORS = ['#d9534f', '#3f6fb5', '#e8e6df', '#3d4047', '#e2a03f', '#4f9a7a', '#8e9aa6', '#7a4b8c', '#c96a4b', '#2e7d86', '#b9c0c6', '#e0c341'];

export function topColor(p: Person): string {
  return TOPS[(p.look >>> 8) % TOPS.length]!;
}

/**
 * Un habitant. (x, y) = pieds à l'écran, z = largeur d'une tuile en pixels.
 * `phase` anime la marche (0 = immobile).
 */
export function drawPerson(ctx: CanvasRenderingContext2D, p: Person, x: number, y: number, z: number, phase: number, moving: boolean, down: boolean, day: Daylight): void {
  const top = tint(topColor(p), day);
  if (z < 11) {
    ctx.fillStyle = 'rgba(40,35,30,0.55)';
    ctx.fillRect(x - 1.5, y - 4, 3, 4.6);
    ctx.fillStyle = top;
    ctx.fillRect(x - 1, y - 3.5, 2, 3.6);
    return;
  }
  const k = p.age < 12 ? 0.68 : p.age < 16 ? 0.84 : 1;
  // De loin, les habitants sont dessinés plus grands que nature pour rester lisibles.
  const H = Math.max(z * 0.2, 7.5) * k; // hauteur totale
  const skin = tint(SKIN[p.look % SKIN.length]!, day);
  const hair = tint(p.age > 62 ? '#d9d6cf' : HAIR[(p.look >>> 4) % HAIR.length]!, day);
  const bottom = tint(BOTTOMS[(p.look >>> 12) % BOTTOMS.length]!, day);
  if (z < 34) {
    ctx.fillStyle = 'rgba(30,40,70,0.25)';
    ctx.fillRect(x - H * 0.22, y - H * 0.06, H * 0.5, H * 0.12);
    ctx.fillStyle = bottom;
    ctx.fillRect(x - H * 0.13, y - H * 0.32, H * 0.26, H * 0.32);
    ctx.fillStyle = top;
    ctx.fillRect(x - H * 0.17, y - H * 0.72, H * 0.34, H * 0.42);
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x, y - H * 0.84, H * 0.17, 0, 6.2832);
    ctx.fill();
    return;
  }
  // Ombre au sol.
  ctx.fillStyle = 'rgba(30,40,70,0.22)';
  ctx.beginPath();
  ctx.ellipse(x, y, H * 0.26, H * 0.11, 0, 0, 6.2832);
  ctx.fill();
  if (down) {
    // Blessé : allongé.
    ctx.fillStyle = bottom;
    ctx.fillRect(x - H * 0.5, y - H * 0.14, H * 0.42, H * 0.16);
    ctx.fillStyle = top;
    ctx.fillRect(x - H * 0.1, y - H * 0.17, H * 0.44, H * 0.2);
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x + H * 0.44, y - H * 0.08, H * 0.13, 0, 6.2832);
    ctx.fill();
    return;
  }
  const sw = moving ? Math.sin(phase) : 0;
  const bob = moving ? Math.abs(Math.cos(phase)) * H * 0.03 : 0;
  const legW = H * 0.1;
  // Jambes.
  ctx.fillStyle = bottom;
  ctx.fillRect(x - H * 0.13 + sw * H * 0.07, y - H * 0.36, legW, H * 0.36 - (sw > 0 ? sw * H * 0.05 : 0));
  ctx.fillRect(x + H * 0.03 - sw * H * 0.07, y - H * 0.36, legW, H * 0.36 - (sw < 0 ? -sw * H * 0.05 : 0));
  // Corps.
  const by = y - H * 0.74 - bob;
  ctx.fillStyle = top;
  roundRect(ctx, x - H * 0.17, by, H * 0.34, H * 0.42, H * 0.09);
  // Bras.
  ctx.fillStyle = shade(top, 0.86);
  ctx.fillRect(x - H * 0.23, by + H * 0.04 + sw * H * 0.03, H * 0.07, H * 0.3);
  ctx.fillRect(x + H * 0.16, by + H * 0.04 - sw * H * 0.03, H * 0.07, H * 0.3);
  // Tête et cheveux.
  const hy = by - H * 0.13;
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(x, hy, H * 0.16, 0, 6.2832);
  ctx.fill();
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.arc(x, hy - H * 0.03, H * 0.165, Math.PI * 1.02, Math.PI * 1.98);
  ctx.fill();
  if (p.female && p.age > 11) ctx.fillRect(x - H * 0.165, hy - H * 0.04, H * 0.07, H * 0.2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.fill();
}

// Tampons pour les coins projetés d'une boîte orientée.
const bx = new Float32Array(8);
const by = new Float32Array(8);
const order = [0, 1, 2, 3];

/** Boîte orientée posée au sol : centre (wx, wy) en tuiles, cap (hx, hy). */
function box(
  ctx: CanvasRenderingContext2D, sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, z: number,
  wx: number, wy: number, hx: number, hy: number, back: number, front: number, hw: number, z0: number, z1: number,
  color: string, topColor: string, day: Daylight,
): void {
  const nx = -hy, ny = hx;
  // Coins : arrière-gauche, arrière-droit, avant-droit, avant-gauche.
  const cx = [wx - hx * back - nx * hw, wx - hx * back + nx * hw, wx + hx * front + nx * hw, wx + hx * front - nx * hw];
  const cy = [wy - hy * back - ny * hw, wy - hy * back + ny * hw, wy + hy * front + ny * hw, wy + hy * front - ny * hw];
  for (let i = 0; i < 4; i++) {
    const X = sx(cx[i]!, cy[i]!), Y = sy(cx[i]!, cy[i]!);
    bx[i] = X; by[i] = Y - z0 * ZS * z;
    bx[i + 4] = X; by[i + 4] = Y - z1 * ZS * z;
  }
  // Faces latérales, de la plus lointaine à la plus proche.
  order.sort((a, b) => cx[a]! + cy[a]! + cx[(a + 1) % 4]! + cy[(a + 1) % 4]! - (cx[b]! + cy[b]! + cx[(b + 1) % 4]! + cy[(b + 1) % 4]!));
  for (let k = 2; k < 4; k++) {
    const i = order[k]!, j = (i + 1) % 4;
    const fx = cy[j]! - cy[i]!, fy = -(cx[j]! - cx[i]!); // normale sortante (non normalisée)
    const l = Math.sqrt(fx * fx + fy * fy) || 1;
    const lit = 0.74 + 0.2 * ((-fx + fy) / l) * 0.7;
    ctx.fillStyle = tint(shade(color, lit), day);
    ctx.beginPath();
    ctx.moveTo(bx[i]!, by[i]!);
    ctx.lineTo(bx[j]!, by[j]!);
    ctx.lineTo(bx[j + 4]!, by[j + 4]!);
    ctx.lineTo(bx[i + 4]!, by[i + 4]!);
    ctx.fill();
  }
  ctx.fillStyle = tint(topColor, day);
  ctx.beginPath();
  ctx.moveTo(bx[4]!, by[4]!);
  ctx.lineTo(bx[5]!, by[5]!);
  ctx.lineTo(bx[6]!, by[6]!);
  ctx.lineTo(bx[7]!, by[7]!);
  ctx.fill();
}

export interface CarView {
  x: number; y: number; hx: number; hy: number;
  crashed: boolean;
  braking: boolean;
}

export function drawCar(
  ctx: CanvasRenderingContext2D, car: Car, v: CarView, z: number,
  sx: (x: number, y: number) => number, sy: (x: number, y: number) => number, timeMs: number, day: Daylight,
): void {
  const X = sx(v.x, v.y), Y = sy(v.x, v.y);
  const base = car.kind === 1 ? '#f4f3ee' : car.kind === 2 ? '#e2a03f' : CAR_COLORS[car.color % CAR_COLORS.length]!;
  if (z < 11) {
    ctx.fillStyle = tint(base, day);
    ctx.fillRect(X - 1.5, Y - 2.5, 3.2, 3.2);
    if (day.night > 0.4) { ctx.fillStyle = '#fff3c4'; ctx.fillRect(X - 0.5 + v.hx - v.hy, Y - 1.5 + (v.hx + v.hy) * 0.5, 1.2, 1.2); }
    return;
  }
  const len = car.kind === 0 ? 0.42 : 0.5;
  const hw = car.kind === 0 ? 0.095 : 0.105;
  const hl = len / 2;
  // Ombre.
  ctx.fillStyle = 'rgba(30,40,70,0.2)';
  ctx.beginPath();
  ctx.ellipse(X + z * 0.02, Y + z * 0.012, z * 0.2, z * 0.085, 0, 0, 6.2832);
  ctx.fill();
  const bodyTop = car.kind === 0 ? 0.085 : 0.11;
  box(ctx, sx, sy, z, v.x, v.y, v.hx, v.hy, hl, hl, hw, 0.025, bodyTop, base, shade(base, 1.06), day);
  if (z >= 20) {
    if (car.kind === 0) {
      // Habitacle vitré.
      box(ctx, sx, sy, z, v.x, v.y, v.hx, v.hy, hl * 0.62, hl * 0.3, hw * 0.86, bodyTop, bodyTop + 0.065, '#5d7f96', shade(base, 0.94), day);
    } else if (car.kind === 1) {
      box(ctx, sx, sy, z, v.x, v.y, v.hx, v.hy, hl, hl * 0.42, hw, bodyTop, bodyTop + 0.07, '#f4f3ee', '#fbfaf6', day);
      box(ctx, sx, sy, z, v.x, v.y, v.hx, v.hy, hl * 0.5, -hl * 0.1, hw * 1.01, 0.06, 0.085, '#d9534f', '#d9534f', day);
    } else {
      box(ctx, sx, sy, z, v.x, v.y, v.hx, v.hy, -hl * 0.1, hl * 0.72, hw, bodyTop, bodyTop + 0.07, '#e2a03f', '#f0b85a', day);
      box(ctx, sx, sy, z, v.x, v.y, v.hx, v.hy, hl * 0.9, -hl * 0.3, hw * 0.3, bodyTop, bodyTop + 0.05, '#4d545c', '#6b737c', day);
    }
  }
  const up = (bodyTop + (car.kind === 0 ? 0.065 : 0.07)) * ZS * z;
  // Gyrophare.
  if (car.kind !== 0 && (car.siren || car.st === 5)) {
    const on = Math.floor(timeMs / 180) % 2 === 0;
    const col = car.kind === 1 ? (on ? '#4aa3ff' : '#e84d4d') : on ? '#ffb020' : '#ffe08a';
    const fx = sx(v.x + v.hx * 0.02, v.y + v.hy * 0.02), fy = sy(v.x + v.hx * 0.02, v.y + v.hy * 0.02) - up;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(fx, fy, Math.max(1.6, z * 0.03), 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 0.25 + day.night * 0.25;
    ctx.beginPath();
    ctx.arc(fx, fy, z * 0.16, 0, 6.2832);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Phares et feux arrière.
  if (z >= 16 && (day.night > 0.25 || v.braking)) {
    const nx = -v.hy, ny = v.hx;
    const h0 = 0.055 * ZS * z;
    const r = Math.max(1, z * 0.018);
    for (const s of [-1, 1]) {
      if (day.night > 0.25 && !v.crashed) {
        ctx.fillStyle = '#fff6cf';
        ctx.beginPath();
        ctx.arc(sx(v.x + v.hx * hl + nx * hw * 0.7 * s, v.y + v.hy * hl + ny * hw * 0.7 * s), sy(v.x + v.hx * hl + nx * hw * 0.7 * s, v.y + v.hy * hl + ny * hw * 0.7 * s) - h0, r, 0, 6.2832);
        ctx.fill();
      }
      ctx.fillStyle = v.braking ? '#ff4b3a' : '#a8322a';
      ctx.beginPath();
      ctx.arc(sx(v.x - v.hx * hl + nx * hw * 0.7 * s, v.y - v.hy * hl + ny * hw * 0.7 * s), sy(v.x - v.hx * hl + nx * hw * 0.7 * s, v.y - v.hy * hl + ny * hw * 0.7 * s) - h0, r, 0, 6.2832);
      ctx.fill();
    }
  }
  // Fumée d'un véhicule accidenté.
  if (v.crashed && z >= 14) {
    for (let i = 0; i < 4; i++) {
      const a = ((timeMs / 1400 + i / 4 + car.id * 0.37) % 1);
      ctx.fillStyle = `rgba(90,90,96,${(0.4 * (1 - a)).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(X + Math.sin(a * 5 + i) * z * 0.05, Y - up - a * z * 0.5, z * (0.05 + a * 0.09), 0, 6.2832);
      ctx.fill();
    }
  }
}
