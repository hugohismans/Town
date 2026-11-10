// Génération procédurale de la ville : fonction pure de la graine.

import { LANE_OFF, MAP_SIZE, SPEED_AVENUE, SPEED_STREET, WALK_OFF, XW_OUT } from './constants';
import * as N from './names';
import { Rng, hash32 } from './rng';
import {
  DX, DY, T_BRIDGE, T_FIELD, T_GARDEN, T_GRASS, T_LOT, T_PARK, T_ROAD, T_WATER,
  type BKind, type Building, type City, type Crosswalk, type Deco, type Dir, type PedLink,
  type REdge, type RNode, type RoadLine,
} from './types';

export function isRoadTile(t: number): boolean {
  return t === T_ROAD || t === T_BRIDGE;
}

/** Positions de a à b incluses, avec des écarts de 4 à 6 tuiles. */
function splitLine(a: number, b: number, rng: Rng): number[] {
  const total = b - a;
  const n = Math.max(1, Math.round(total / 5));
  const gaps: number[] = [];
  for (let i = 0; i < n; i++) gaps.push(Math.floor(total / n) + (i < total % n ? 1 : 0));
  rng.shuffle(gaps);
  for (let k = 0; k < n * 2; k++) {
    const i = rng.int(n);
    const j = rng.int(n);
    if (i !== j && (gaps[i] as number) < 6 && (gaps[j] as number) > 4) {
      gaps[i]!++;
      gaps[j]!--;
    }
  }
  const out = [a];
  let p = a;
  for (const g of gaps) out.push((p += g));
  return out;
}

interface Block {
  tiles: number[];
  x0: number; y0: number; x1: number; y1: number; // bornes incluses
  rect: boolean;
  district: 0 | 1 | 2;
  park: boolean;
}

interface Spec { kind: BKind; w: number; h: number; weight: number }

const DISTRICT_SPECS: Spec[][] = [
  [
    { kind: 'office', w: 2, h: 2, weight: 20 }, { kind: 'office', w: 2, h: 1, weight: 11 },
    { kind: 'office', w: 1, h: 2, weight: 11 }, { kind: 'office', w: 1, h: 1, weight: 10 },
    { kind: 'shop', w: 1, h: 1, weight: 17 }, { kind: 'cafe', w: 1, h: 1, weight: 9 },
    { kind: 'restaurant', w: 1, h: 1, weight: 7 }, { kind: 'apartment', w: 2, h: 1, weight: 5 },
    { kind: 'apartment', w: 1, h: 2, weight: 4 }, { kind: 'bar', w: 1, h: 1, weight: 4 },
  ],
  [
    { kind: 'apartment', w: 2, h: 2, weight: 5 }, { kind: 'apartment', w: 2, h: 1, weight: 9 },
    { kind: 'apartment', w: 1, h: 2, weight: 8 }, { kind: 'shop', w: 1, h: 1, weight: 14 },
    { kind: 'cafe', w: 1, h: 1, weight: 6 }, { kind: 'restaurant', w: 1, h: 1, weight: 4 },
    { kind: 'office', w: 2, h: 1, weight: 7 }, { kind: 'office', w: 1, h: 1, weight: 5 },
    { kind: 'house', w: 1, h: 1, weight: 26 }, { kind: 'house', w: 2, h: 1, weight: 6 },
    { kind: 'house', w: 1, h: 2, weight: 6 }, { kind: 'bar', w: 1, h: 1, weight: 2 },
  ],
  [
    { kind: 'house', w: 1, h: 1, weight: 56 }, { kind: 'house', w: 2, h: 1, weight: 14 },
    { kind: 'house', w: 1, h: 2, weight: 14 }, { kind: 'apartment', w: 2, h: 1, weight: 3 },
    { kind: 'apartment', w: 1, h: 2, weight: 3 }, { kind: 'shop', w: 1, h: 1, weight: 4 },
    { kind: 'cafe', w: 1, h: 1, weight: 2 },
  ],
];

export function generateCity(seed: number): City {
  const rng = new Rng(seed ^ 0x51ed27);
  const W = MAP_SIZE;
  const H = MAP_SIZE;
  const idx = (x: number, y: number) => y * W + x;

  // ------------------------------------------------------------ tracé
  const canalW = 3;
  const canalX = rng.between(Math.round(W * 0.57), Math.round(W * 0.63));
  const q1 = canalX - 1;
  const q2 = canalX + canalW;
  const vxWest = splitLine(3, q1, rng);
  const vxEast = splitLine(q2, W - 4, rng);
  const vx = [...vxWest, ...vxEast];
  const hy = splitLine(3, H - 4, rng);
  const nV = vx.length;
  const nH = hy.length;
  const iq1 = vxWest.length - 1; // indice de la colonne du quai ouest

  const nearest = (arr: number[], target: number, lo: number, hi: number) => {
    let best = lo;
    for (let i = lo; i <= hi; i++) if (Math.abs((arr[i] as number) - target) < Math.abs((arr[best] as number) - target)) best = i;
    return best;
  };
  const avV = nearest(vx, Math.round(q1 * 0.5), 1, iq1 - 1);
  const avH = nearest(hy, Math.round(H / 2), 1, nH - 2);

  const lines: RoadLine[] = [];
  const avNames = rng.shuffle([...N.AVENUES]);
  const stNames = rng.shuffle([...N.STREETS]);
  const quNames = rng.shuffle([...N.QUAYS]);
  let stI = 0;
  const lineH: number[] = [];
  const lineV: number[] = [];
  for (let j = 0; j < nH; j++) {
    const kind = j === 0 || j === nH - 1 ? 'boulevard' : j === avH ? 'avenue' : 'street';
    const name =
      kind === 'boulevard' ? `boulevard ${j === 0 ? N.BOULEVARDS[0] : N.BOULEVARDS[2]}`
      : kind === 'avenue' ? `avenue ${avNames[0]}`
      : `rue ${stNames[stI++ % stNames.length]}`;
    lineH.push(lines.length);
    lines.push({ id: lines.length, axis: 0, pos: hy[j] as number, kind, name });
  }
  for (let i = 0; i < nV; i++) {
    const kind = i === 0 || i === nV - 1 ? 'boulevard' : i === avV ? 'avenue' : i === iq1 || i === iq1 + 1 ? 'quay' : 'street';
    const name =
      kind === 'boulevard' ? `boulevard ${i === 0 ? N.BOULEVARDS[3] : N.BOULEVARDS[1]}`
      : kind === 'avenue' ? `avenue ${avNames[1]}`
      : kind === 'quay' ? `quai ${quNames[i === iq1 ? 0 : 1]}`
      : `rue ${stNames[stI++ % stNames.length]}`;
    lineV.push(lines.length);
    lines.push({ id: lines.length, axis: 1, pos: vx[i] as number, kind, name });
  }

  // Tronçons : hSeg[j][i] relie (vx[i], hy[j]) à (vx[i+1], hy[j]).
  const hSeg: boolean[][] = [];
  const vSeg: boolean[][] = [];
  const bridgeRows = new Set<number>([0, nH - 1, avH]);
  {
    const others: number[] = [];
    for (let j = 2; j < nH - 2; j++) if (Math.abs(j - avH) >= 2) others.push(j);
    if (others.length) bridgeRows.add(rng.pick(others));
  }
  for (let j = 0; j < nH; j++) {
    hSeg.push([]);
    for (let i = 0; i < nV - 1; i++) hSeg[j]!.push(i !== iq1 || bridgeRows.has(j));
  }
  for (let i = 0; i < nV; i++) {
    vSeg.push([]);
    for (let j = 0; j < nH - 1; j++) vSeg[i]!.push(true);
  }
  const degree = (i: number, j: number) =>
    (i > 0 && hSeg[j]![i - 1] ? 1 : 0) + (i < nV - 1 && hSeg[j]![i] ? 1 : 0) +
    (j > 0 && vSeg[i]![j - 1] ? 1 : 0) + (j < nH - 1 && vSeg[i]![j] ? 1 : 0);
  const connected = () => {
    const seen = new Uint8Array(nV * nH);
    const stack = [0];
    seen[0] = 1;
    let count = 0;
    while (stack.length) {
      const k = stack.pop() as number;
      count++;
      const i = k % nV;
      const j = (k - i) / nV;
      const push = (ii: number, jj: number) => {
        const kk = jj * nV + ii;
        if (!seen[kk]) { seen[kk] = 1; stack.push(kk); }
      };
      if (i > 0 && hSeg[j]![i - 1]) push(i - 1, j);
      if (i < nV - 1 && hSeg[j]![i]) push(i + 1, j);
      if (j > 0 && vSeg[i]![j - 1]) push(i, j - 1);
      if (j < nH - 1 && vSeg[i]![j]) push(i, j + 1);
    }
    return count === nV * nH;
  };
  // On retire quelques tronçons de petites rues pour casser le damier.
  {
    const cands: [number, number, number][] = []; // [axe, i, j]
    for (let j = 1; j < nH - 1; j++)
      if (j !== avH) for (let i = 0; i < nV - 1; i++) if (i !== iq1) cands.push([0, i, j]);
    for (let i = 1; i < nV - 1; i++)
      if (i !== avV && i !== iq1 && i !== iq1 + 1) for (let j = 0; j < nH - 1; j++) cands.push([1, i, j]);
    rng.shuffle(cands);
    let budget = Math.round(cands.length * 0.17);
    for (const [axis, i, j] of cands) {
      if (budget <= 0) break;
      const seg = axis === 0 ? hSeg[j]! : vSeg[i]!;
      const k = axis === 0 ? i : j;
      const [i2, j2] = axis === 0 ? [i + 1, j] : [i, j + 1];
      if (degree(i, j) < 4 || degree(i2, j2) < 4) continue;
      seg[k] = false;
      if (connected()) budget--;
      else seg[k] = true;
    }
  }

  // ------------------------------------------------------------ tuiles
  const tiles = new Uint8Array(W * H);
  const lot = new Int16Array(W * H).fill(-1);
  for (let y = 0; y < H; y++) for (let x = canalX; x < canalX + canalW; x++) tiles[idx(x, y)] = T_WATER;
  const setRoad = (x: number, y: number) => {
    const k = idx(x, y);
    tiles[k] = tiles[k] === T_WATER || tiles[k] === T_BRIDGE ? T_BRIDGE : T_ROAD;
  };
  for (let j = 0; j < nH; j++)
    for (let i = 0; i < nV - 1; i++)
      if (hSeg[j]![i]) for (let x = vx[i] as number; x <= (vx[i + 1] as number); x++) setRoad(x, hy[j] as number);
  for (let i = 0; i < nV; i++)
    for (let j = 0; j < nH - 1; j++)
      if (vSeg[i]![j]) for (let y = hy[j] as number; y <= (hy[j + 1] as number); y++) setRoad(vx[i] as number, y);

  // ------------------------------------------------------------ graphe routier
  const nodes: RNode[] = [];
  const nodeAt = new Int16Array(W * H).fill(-1);
  const gridNode: number[] = [];
  const rank = (l: RoadLine) => (l.kind === 'avenue' ? 3 : l.kind === 'street' ? 1 : 2);
  for (let j = 0; j < nH; j++)
    for (let i = 0; i < nV; i++) {
      const id = nodes.length;
      gridNode.push(id);
      const x = vx[i] as number;
      const y = hy[j] as number;
      nodeAt[idx(x, y)] = id;
      nodes.push({
        id, x, y, out: [-1, -1, -1, -1], inn: [-1, -1, -1, -1], deg: degree(i, j),
        control: 'none', major: 0, phase: hash32(seed, id) % 170, xw: [-1, -1, -1, -1],
        lineH: lineH[j] as number, lineV: lineV[i] as number,
      });
    }
  const edges: REdge[] = [];
  const edgeAt = new Int16Array(W * H).fill(-1);
  const addPair = (a: number, b: number, dir: Dir, line: number, bridge: boolean) => {
    const A = nodes[a] as RNode;
    const B = nodes[b] as RNode;
    const dist = Math.abs(B.x - A.x) + Math.abs(B.y - A.y);
    const L = lines[line] as RoadLine;
    const speed = L.kind === 'street' ? SPEED_STREET : SPEED_AVENUE;
    const mk = (from: RNode, to: RNode, d: Dir): REdge => ({
      id: edges.length, from: from.id, to: to.id, dir: d, len: dist - 1,
      x0: from.x + 0.5 + DX[d] * 0.5 - DY[d] * LANE_OFF,
      y0: from.y + 0.5 + DY[d] * 0.5 + DX[d] * LANE_OFF,
      line, speed, rev: -1, bridge,
    });
    const e1 = mk(A, B, dir);
    edges.push(e1);
    const e2 = mk(B, A, ((dir + 2) % 4) as Dir);
    edges.push(e2);
    e1.rev = e2.id;
    e2.rev = e1.id;
    A.out[dir] = e1.id;
    B.inn[dir] = e1.id;
    B.out[e2.dir] = e2.id;
    A.inn[e2.dir] = e2.id;
    for (let k = 1; k < dist; k++) edgeAt[idx(A.x + DX[dir] * k, A.y + DY[dir] * k)] = e1.id;
  };
  for (let j = 0; j < nH; j++)
    for (let i = 0; i < nV; i++) {
      const a = gridNode[j * nV + i] as number;
      if (i < nV - 1 && hSeg[j]![i]) addPair(a, gridNode[j * nV + i + 1] as number, 0, lineH[j] as number, i === iq1);
      if (j < nH - 1 && vSeg[i]![j]) addPair(a, gridNode[(j + 1) * nV + i] as number, 1, lineV[i] as number, false);
    }
  for (const n of nodes) {
    const rh = rank(lines[n.lineH] as RoadLine);
    const rv = rank(lines[n.lineV] as RoadLine);
    if (n.deg <= 2) n.control = 'none';
    else if (rh >= 2 && rv >= 2) n.control = 'lights';
    else n.control = 'priority';
    const hThrough = n.out[0] !== -1 && n.out[2] !== -1;
    const vThrough = n.out[1] !== -1 && n.out[3] !== -1;
    n.major = rh > rv ? 0 : rv > rh ? 1 : hThrough && !vThrough ? 0 : vThrough && !hThrough ? 1 : ((hash32(seed, n.id + 999) & 1) as 0 | 1);
  }

  // ------------------------------------------------------------ graphe piéton
  const pedX: number[] = [];
  const pedY: number[] = [];
  const pedAdj: PedLink[][] = [];
  const crosswalks: Crosswalk[] = [];
  const addPed = (x: number, y: number) => {
    pedX.push(x);
    pedY.push(y);
    pedAdj.push([]);
    return pedX.length - 1;
  };
  const link = (a: number, b: number, xw = -1) => {
    const dx = (pedX[a] as number) - (pedX[b] as number);
    const dy = (pedY[a] as number) - (pedY[b] as number);
    const len = Math.abs(dx) + Math.abs(dy);
    pedAdj[a]!.push({ to: b, len, xw });
    pedAdj[b]!.push({ to: a, len, xw });
  };
  // Coins : 0 NO, 1 NE, 2 SE, 3 SO. anchor[n*8 + dir*2 + côté].
  const CORNER_X = [-1, 1, 1, -1];
  const CORNER_Y = [-1, -1, 1, 1];
  const ARM_CORNERS: [number, number][] = [[1, 2], [3, 2], [0, 3], [0, 1]]; // par dir : [côté 0, côté 1]
  const corner = new Int32Array(nodes.length * 4);
  const anchor = new Int32Array(nodes.length * 8);
  for (const n of nodes) {
    const cx = n.x + 0.5;
    const cy = n.y + 0.5;
    for (let q = 0; q < 4; q++) corner[n.id * 4 + q] = addPed(cx + (CORNER_X[q] as number) * WALK_OFF, cy + (CORNER_Y[q] as number) * WALK_OFF);
    for (let d = 0; d < 4; d++) {
      const [c0, c1] = ARM_CORNERS[d] as [number, number];
      const p0 = corner[n.id * 4 + c0] as number;
      const p1 = corner[n.id * 4 + c1] as number;
      if (n.out[d] === -1) {
        link(p0, p1);
        continue;
      }
      if (n.deg >= 3) {
        const xw = crosswalks.length;
        crosswalks.push({ id: xw, node: n.id, arm: d as Dir, x: cx + DX[d as Dir] * XW_OUT, y: cy + DY[d as Dir] * XW_OUT });
        n.xw[d] = xw;
        const horiz = d === 0 || d === 2;
        const a0 = addPed(cx + DX[d as Dir] * XW_OUT - (horiz ? 0 : WALK_OFF), cy + DY[d as Dir] * XW_OUT - (horiz ? WALK_OFF : 0));
        const a1 = addPed(cx + DX[d as Dir] * XW_OUT + (horiz ? 0 : WALK_OFF), cy + DY[d as Dir] * XW_OUT + (horiz ? WALK_OFF : 0));
        link(a0, p0);
        link(a1, p1);
        link(a0, a1, xw);
        anchor[n.id * 8 + d * 2] = a0;
        anchor[n.id * 8 + d * 2 + 1] = a1;
      } else {
        anchor[n.id * 8 + d * 2] = p0;
        anchor[n.id * 8 + d * 2 + 1] = p1;
      }
    }
  }
  for (const e of edges) {
    if (e.dir > 1) continue;
    for (let side = 0; side < 2; side++)
      link(anchor[e.from * 8 + e.dir * 2 + side] as number, anchor[e.to * 8 + ((e.dir + 2) % 4) * 2 + side] as number);
  }

  // ------------------------------------------------------------ îlots
  const centerX = (vx[avV] as number) + 0.5;
  const centerY = (hy[avH] as number) + 0.5;
  const blockOf = new Int16Array(W * H).fill(-1);
  const blocks: Block[] = [];
  for (let y0 = 0; y0 < H; y0++)
    for (let x0 = 0; x0 < W; x0++) {
      const k0 = idx(x0, y0);
      if (tiles[k0] !== T_GRASS || blockOf[k0] !== -1) continue;
      const b: Block = { tiles: [], x0, y0, x1: x0, y1: y0, rect: false, district: 2, park: false };
      const id = blocks.length;
      let border = false;
      const stack = [k0];
      blockOf[k0] = id;
      while (stack.length) {
        const k = stack.pop() as number;
        b.tiles.push(k);
        const x = k % W;
        const y = (k - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
        b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x);
        b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
        for (let d = 0; d < 4; d++) {
          const xx = x + DX[d as Dir];
          const yy = y + DY[d as Dir];
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const kk = idx(xx, yy);
          if (tiles[kk] === T_GRASS && blockOf[kk] === -1) { blockOf[kk] = id; stack.push(kk); }
        }
      }
      blocks.push(b);
      if (border) {
        for (const k of b.tiles) blockOf[k] = -2;
        b.tiles = [];
        continue;
      }
      b.tiles.sort((a, c) => a - c);
      b.rect = b.tiles.length === (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);
      const mx = (b.x0 + b.x1 + 1) / 2 - centerX;
      const my = (b.y0 + b.y1 + 1) / 2 - centerY;
      const dn = Math.sqrt(mx * mx + my * my) / (W * 0.5);
      b.district = dn < 0.3 ? 0 : dn < 0.62 ? 1 : 2;
    }
  const cityBlocks = blocks.filter((b) => b.tiles.length > 0);

  // ------------------------------------------------------------ bâtiments
  const buildings: Building[] = [];
  const trees: Deco[] = [];
  const free = (x: number, y: number, blockId: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const k = idx(x, y);
    return blockOf[k] === blockId && tiles[k] === T_GRASS && lot[k] === -1;
  };
  const doorTile = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && isRoadTile(tiles[idx(x, y)] as number) && nodeAt[idx(x, y)] === -1;
  /** Cherche la porte : d'abord les faces visibles (sud, est), puis nord, ouest. */
  const findDoor = (x: number, y: number, w: number, h: number): [Dir, number, number] | null => {
    for (const d of [1, 0, 3, 2] as Dir[]) {
      const c: [number, number][] = [];
      if (d === 1) for (let i = 0; i < w; i++) if (doorTile(x + i, y + h)) c.push([x + i, y + h]);
      if (d === 3) for (let i = 0; i < w; i++) if (doorTile(x + i, y - 1)) c.push([x + i, y - 1]);
      if (d === 0) for (let i = 0; i < h; i++) if (doorTile(x + w, y + i)) c.push([x + w, y + i]);
      if (d === 2) for (let i = 0; i < h; i++) if (doorTile(x - 1, y + i)) c.push([x - 1, y + i]);
      if (c.length) {
        const m = c[c.length >> 1] as [number, number];
        return [d, m[0], m[1]];
      }
    }
    return null;
  };
  const dist1 = (x0: number, y0: number, x1: number, y1: number) => Math.abs(x0 - x1) + Math.abs(y0 - y1);
  const place = (kind: BKind, x: number, y: number, w: number, h: number, district: 0 | 1 | 2, tileType = T_LOT): Building | null => {
    const door = findDoor(x, y, w, h);
    if (!door) return null;
    const [doorDir, ax, ay] = door;
    const id = buildings.length;
    const e = edges[edgeAt[idx(ax, ay)] as number] as REdge;
    const A = nodes[e.from] as RNode;
    const B = nodes[e.to] as RNode;
    const side = doorDir === 0 || doorDir === 1 ? 0 : 1;
    const pedA = anchor[A.id * 8 + e.dir * 2 + side] as number;
    const pedB = anchor[B.id * 8 + ((e.dir + 2) % 4) * 2 + side] as number;
    const doorX = ax + 0.5 - DX[doorDir] * WALK_OFF;
    const doorY = ay + 0.5 - DY[doorDir] * WALK_OFF;
    const along = dist1(ax, ay, A.x, A.y);
    const b: Building = {
      id, kind, name: '', x, y, w, h, floors: 1, variant: hash32(seed, id * 7 + 13), district,
      doorDir, ax, ay, doorX, doorY, pedA, pedB,
      pedDa: dist1(doorX, doorY, pedX[pedA] as number, pedY[pedA] as number),
      pedLen: dist1(pedX[pedA] as number, pedY[pedA] as number, pedX[pedB] as number, pedY[pedB] as number),
      edges: [e.id, e.rev], edgeS: [along - 0.5, e.len - along + 0.5], line: e.line,
      jobs: 0, units: 0, openFrom: 0, openTo: 1440,
    };
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      tiles[idx(xx, yy)] = tileType;
      lot[idx(xx, yy)] = id;
    }
    buildings.push(b);
    return b;
  };
  const fits = (x: number, y: number, w: number, h: number, blockId: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (!free(xx, yy, blockId)) return false;
    return findDoor(x, y, w, h) !== null;
  };
  const blockId = (b: Block) => blockOf[b.tiles[0] as number] as number;

  // Parcs : des îlots rectangulaires entiers.
  {
    const rects = cityBlocks.filter((b) => b.rect && b.tiles.length >= 9 && b.tiles.length <= 30);
    const score = (b: Block, want: number) => Math.abs(b.district - want) * 10 + rng.next();
    const picks: Block[] = [];
    for (const want of [0, 2, 1]) {
      const cand = rects.filter((b) => !picks.includes(b)).sort((a, c) => score(a, want) - score(c, want))[0];
      if (cand) picks.push(cand);
    }
    for (const b of picks) {
      const p = place('park', b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1, b.district, T_PARK);
      if (p) b.park = true;
    }
  }
  // Équipements : hôpital, écoles, mairie, cinéma, garage.
  const placeSpecial = (kind: BKind, w: number, h: number, districts: number[], east: boolean | null): Building | null => {
    const cands = rng.shuffle(cityBlocks.filter((b) => !b.park && districts.includes(b.district) && (east === null || (b.x0 > canalX) === east)));
    for (const b of cands)
      for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++)
        if (fits(x, y, w, h, blockId(b))) return place(kind, x, y, w, h, b.district);
    return null;
  };
  const special = (kind: BKind, w: number, h: number, districts: number[], east: boolean | null = null) =>
    placeSpecial(kind, w, h, districts, east) ?? placeSpecial(kind, w, h, [0, 1, 2], null) ?? placeSpecial(kind, 2, 1, [0, 1, 2], null) ?? placeSpecial(kind, 1, 1, [0, 1, 2], null);
  special('hospital', 3, 2, [1], null);
  special('townhall', 2, 2, [0], null);
  special('school', 3, 2, [2, 1], false);
  special('school', 3, 2, [2, 1], true);
  special('cinema', 2, 2, [0, 1], null);
  special('garage', 2, 1, [2, 1], null);

  // Remplissage des îlots.
  for (const b of cityBlocks) {
    if (b.park) continue;
    const id = blockId(b);
    const specs = DISTRICT_SPECS[b.district] as Spec[];
    const total = specs.reduce((s, sp) => s + sp.weight, 0);
    const density = b.district === 2 ? 0.46 : b.district === 1 ? 0.82 : 1;
    for (const k of b.tiles) {
      if (tiles[k] !== T_GRASS || lot[k] !== -1) continue;
      const x = k % W;
      const y = (k - x) / W;
      let done = false;
      if (rng.chance(density)) {
        let r = rng.next() * total;
        let spec = specs[0] as Spec;
        for (const sp of specs) { r -= sp.weight; if (r <= 0) { spec = sp; break; } }
        if (fits(x, y, spec.w, spec.h, id)) done = place(spec.kind, x, y, spec.w, spec.h, b.district) !== null;
        else if (fits(x, y, 1, 1, id)) done = place(spec.w * spec.h > 1 ? (b.district === 0 ? 'shop' : 'house') : spec.kind, x, y, 1, 1, b.district) !== null;
      }
      if (!done) {
        tiles[k] = T_GARDEN;
        if (rng.chance(0.55)) trees.push({ x: x + rng.range(0.3, 0.7), y: y + rng.range(0.3, 0.7), kind: rng.int(4), size: rng.range(0.75, 1.1) });
      }
    }
  }
  // Minimums garantis : on reconvertit quelques maisons.
  const ensure = (kind: BKind, min: number) => {
    let have = buildings.filter((b) => b.kind === kind).length;
    const pool = rng.shuffle(buildings.filter((b) => b.kind === 'house' && b.district <= 1));
    const pool2 = rng.shuffle(buildings.filter((b) => b.kind === 'house' && b.district === 2));
    for (const b of [...pool, ...pool2]) {
      if (have >= min) break;
      b.kind = kind;
      have++;
    }
  };
  ensure('cafe', 7);
  ensure('restaurant', 5);
  ensure('shop', 10);
  ensure('bar', 3);
  ensure('office', 6);

  // Détails : étages, emplois, horaires, noms.
  const used = new Map<string, number>();
  const uniq = (name: string) => {
    const n = (used.get(name) ?? 0) + 1;
    used.set(name, n);
    return n === 1 ? name : `${name} ${['', '', 'bis', 'ter', 'IV', 'V', 'VI', 'VII'][n] ?? n}`;
  };
  const street = (b: Building) => (lines[b.line] as RoadLine).name;
  let houseNo = 0;
  for (const b of buildings) {
    const r = new Rng(b.variant);
    const area = b.w * b.h;
    switch (b.kind) {
      case 'house':
        b.floors = r.chance(0.3) ? 2 : 1;
        b.units = 1;
        b.name = `${2 + ((houseNo++ * 2) % 60)}, ${street(b)}`;
        break;
      case 'apartment':
        b.floors = b.district === 0 ? r.between(4, 6) : r.between(3, 5);
        b.units = Math.max(2, Math.round(b.floors * area * 0.4));
        b.name = uniq(`Résidence ${street(b).replace(/^(rue|avenue|boulevard|quai) /, '')}`);
        break;
      case 'office':
        b.floors = area === 4 ? r.between(4, b.district === 0 ? 8 : 5) : area === 2 ? r.between(3, 5) : r.between(2, 3);
        b.jobs = area === 4 ? 13 : area === 2 ? 8 : 4;
        b.openFrom = 7 * 60; b.openTo = 20 * 60;
        b.name = uniq(r.pick(N.OFFICES));
        break;
      case 'shop': {
        const t = N.SHOPS[b.variant % N.SHOPS.length] as [string, string];
        b.floors = r.chance(0.5) ? 2 : 1;
        b.jobs = 2;
        b.openFrom = t[0] === 'Boulangerie' ? 6 * 60 + 30 : 9 * 60;
        b.openTo = 19 * 60 + 30;
        b.name = uniq(`${t[0]} ${r.pick(N.SHOP_SUFFIX)}`);
        break;
      }
      case 'cafe':
        b.floors = r.chance(0.5) ? 2 : 1; b.jobs = 3; b.openFrom = 7 * 60; b.openTo = 22 * 60;
        b.name = uniq(r.pick(N.CAFES));
        break;
      case 'restaurant':
        b.floors = r.chance(0.5) ? 2 : 1; b.jobs = 4; b.openFrom = 11 * 60; b.openTo = 23 * 60;
        b.name = uniq(r.pick(N.RESTAURANTS));
        break;
      case 'bar':
        b.floors = 2; b.jobs = 3; b.openFrom = 17 * 60; b.openTo = 26 * 60;
        b.name = uniq(r.pick(N.BARS));
        break;
      case 'hospital':
        b.floors = 4; b.jobs = 18; b.name = `Hôpital ${r.pick(N.SAINTS)}`;
        break;
      case 'school':
        b.floors = 2; b.jobs = 8; b.openFrom = 7 * 60 + 30; b.openTo = 17 * 60;
        b.name = uniq(r.pick(N.SCHOOLS));
        break;
      case 'townhall':
        b.floors = 2; b.jobs = 7; b.openFrom = 8 * 60 + 30; b.openTo = 17 * 60 + 30; b.name = 'Mairie';
        break;
      case 'cinema':
        b.floors = 2; b.jobs = 4; b.openFrom = 13 * 60; b.openTo = 24 * 60; b.name = `Cinéma ${r.pick(['Le Rex', 'Lumière', 'Le Palace', 'Eldorado'])}`;
        break;
      case 'garage':
        b.floors = 1; b.jobs = 4; b.openFrom = 7 * 60 + 30; b.openTo = 18 * 60 + 30; b.name = `Garage ${r.pick(N.LAST)}`;
        break;
      case 'park':
        b.floors = 0; b.openFrom = 6 * 60; b.openTo = 22 * 60;
        b.name = uniq(r.pick(N.PARKS));
        break;
    }
  }

  // ------------------------------------------------------------ décor
  for (const b of buildings) {
    if (b.kind !== 'park') continue;
    const n = Math.round(b.w * b.h * 0.9);
    for (let i = 0; i < n; i++) {
      const tx = b.x + rng.range(0.25, b.w - 0.25);
      const ty = b.y + rng.range(0.25, b.h - 0.25);
      // On garde les allées (croix centrale) dégagées.
      if (Math.abs(tx - (b.x + b.w / 2)) < 0.45 || Math.abs(ty - (b.y + b.h / 2)) < 0.45) continue;
      trees.push({ x: tx, y: ty, kind: rng.int(4), size: rng.range(0.85, 1.3) });
    }
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = idx(x, y);
      if (blockOf[k] !== -2) continue;
      // Campagne : champs en damier et bosquets.
      const patch = hash32(seed, ((x >> 2) * 131 + (y >> 2)) | 0);
      if (patch % 5 < 2) tiles[k] = T_FIELD;
      const grove = hash32(seed, ((x >> 1) * 977 + (y >> 1) + 5) | 0) % 7 === 0;
      if (tiles[k] !== T_FIELD && rng.chance(grove ? 0.7 : 0.06))
        trees.push({ x: x + rng.range(0.25, 0.75), y: y + rng.range(0.25, 0.75), kind: rng.int(4), size: rng.range(0.8, 1.35) });
    }
  const lamps: Deco[] = [];
  for (const e of edges) {
    if (e.dir > 1) continue;
    const A = nodes[e.from] as RNode;
    for (let k = 1; k <= e.len; k++) {
      if (k % 3 !== 1) continue;
      const side = ((k / 3) | 0) % 2 === 0 ? -1 : 1;
      const x = A.x + 0.5 + DX[e.dir] * k;
      const y = A.y + 0.5 + DY[e.dir] * k;
      lamps.push({ x: x - DY[e.dir] * side * 0.45, y: y + DX[e.dir] * side * 0.45, kind: side, size: 1 });
    }
  }

  const byKind: Record<string, number[]> = {};
  for (const b of buildings) (byKind[b.kind] ??= []).push(b.id);

  const cityName = `${rng.pick(N.CITY_A)}${(() => { const s = rng.pick(N.CITY_B); return s ? `-${s}` : ''; })()}`;
  return {
    seed, name: cityName, w: W, h: H, tiles, lot, lines, nodes, nodeAt, edges, edgeAt,
    pedX, pedY, pedAdj, crosswalks, buildings, byKind, trees, lamps, canalX, canalW,
    centerX, centerY,
    hospital: (byKind['hospital'] ?? [0])[0] as number,
    garage: (byKind['garage'] ?? [0])[0] as number,
  };
}
