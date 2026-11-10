// Géométrie des voies : position d'une voiture sur une arête ou dans un
// carrefour, longueur des mouvements, table des conflits entre mouvements.

import { CAR_LEN, LANE_OFF, STOP_BACK } from './constants';
import { DX, DY, type Car, type City, type Dir, type REdge } from './types';

// Un mouvement = dirIn * 4 + dirOut (directions de déplacement).
const P0X = new Float64Array(16), P0Y = new Float64Array(16);
const PCX = new Float64Array(16), PCY = new Float64Array(16);
const P1X = new Float64Array(16), P1Y = new Float64Array(16);
export const MOV_LEN = new Float64Array(16);
/** CONFLICT[a * 16 + b] = 1 si les deux mouvements ne peuvent pas cohabiter. */
export const CONFLICT = new Uint8Array(256);

function bez(mv: number, u: number): [number, number] {
  const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
  return [a * P0X[mv]! + b * PCX[mv]! + c * P1X[mv]!, a * P0Y[mv]! + b * PCY[mv]! + c * P1Y[mv]!];
}

(function init(): void {
  for (let i = 0; i < 4; i++)
    for (let o = 0; o < 4; o++) {
      const mv = i * 4 + o;
      const ix = DX[i as Dir], iy = DY[i as Dir], ox = DX[o as Dir], oy = DY[o as Dir];
      // Entrée et sortie sur la voie de droite (normale à droite = (-dy, dx)).
      const ex = -ix * 0.5 - iy * LANE_OFF, ey = -iy * 0.5 + ix * LANE_OFF;
      const sx = ox * 0.5 - oy * LANE_OFF, sy = oy * 0.5 + ox * LANE_OFF;
      P0X[mv] = ex; P0Y[mv] = ey; P1X[mv] = sx; P1Y[mv] = sy;
      if (i === o || (i + 2) % 4 === o) {
        PCX[mv] = (ex + sx) / 2; PCY[mv] = (ey + sy) / 2;
      } else {
        const k = (sx - ex) * ix + (sy - ey) * iy;
        PCX[mv] = ex + ix * k; PCY[mv] = ey + iy * k;
      }
      let len = 0;
      let [px, py] = bez(mv, 0);
      for (let s = 1; s <= 12; s++) {
        const [qx, qy] = bez(mv, s / 12);
        len += Math.sqrt((qx - px) * (qx - px) + (qy - py) * (qy - py));
        px = qx; py = qy;
      }
      MOV_LEN[mv] = len;
    }
  for (let a = 0; a < 16; a++)
    for (let b = 0; b < 16; b++) {
      let hit = a >> 2 === b >> 2; // même voie d'entrée : un seul à la fois
      for (let s = 0; s <= 10 && !hit; s++)
        for (let t = 0; t <= 10 && !hit; t++) {
          const [ax, ay] = bez(a, s / 10);
          const [bx, by] = bez(b, t / 10);
          if ((ax - bx) * (ax - bx) + (ay - by) * (ay - by) < 0.22 * 0.22) hit = true;
        }
      CONFLICT[a * 16 + b] = hit ? 1 : 0;
    }
})();

export function stopLine(city: City, e: REdge): number {
  return city.nodes[e.to]!.deg >= 3 ? e.len - STOP_BACK : e.len;
}

export interface Pose {
  x: number;
  y: number;
  hx: number; // cap (vecteur unitaire approximatif)
  hy: number;
}

function onCurve(city: City, nodeId: number, mv: number, t: number, out: Pose): void {
  const n = city.nodes[nodeId]!;
  const u = Math.max(0, Math.min(1, t / MOV_LEN[mv]!));
  const [x, y] = bez(mv, u);
  out.x = n.x + 0.5 + x;
  out.y = n.y + 0.5 + y;
  // Dérivée de la courbe.
  let hx = 2 * (1 - u) * (PCX[mv]! - P0X[mv]!) + 2 * u * (P1X[mv]! - PCX[mv]!);
  let hy = 2 * (1 - u) * (PCY[mv]! - P0Y[mv]!) + 2 * u * (P1Y[mv]! - PCY[mv]!);
  const l = Math.sqrt(hx * hx + hy * hy) || 1;
  hx /= l; hy /= l;
  out.hx = hx; out.hy = hy;
}

/** Position du point situé à `back` derrière le pare-chocs avant. */
export function poseAt(city: City, car: Car, back: number, out: Pose): void {
  const e = city.edges[car.e]!;
  if (car.node >= 0) {
    const t = car.s - back;
    if (t >= 0) onCurve(city, car.node, car.mv, t, out);
    else {
      const s = e.len + t;
      out.x = e.x0 + DX[e.dir] * s; out.y = e.y0 + DY[e.dir] * s; out.hx = DX[e.dir]; out.hy = DY[e.dir];
    }
    return;
  }
  const s = car.s - back;
  if (s < 0 && car.ri > 0) {
    const prev = city.edges[car.route[car.ri - 1]!];
    if (prev && prev.to === e.from) {
      const mv = prev.dir * 4 + e.dir;
      const t = MOV_LEN[mv]! + s;
      if (t >= 0) { onCurve(city, e.from, mv, t, out); return; }
    }
  }
  out.x = e.x0 + DX[e.dir] * s; out.y = e.y0 + DY[e.dir] * s; out.hx = DX[e.dir]; out.hy = DY[e.dir];
}

/** Centre de la voiture. */
export function carPose(city: City, car: Car, out: Pose): void {
  poseAt(city, car, CAR_LEN / 2, out);
}
