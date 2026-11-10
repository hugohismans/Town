// Plus courts chemins : trottoirs (piétons) et voies (voitures). Dijkstra avec
// départage par identifiant, donc déterministe.

import type { Building, City, Walk, World } from './types';

// Tas binaire minimal sur (coût, identifiant).
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number { return this.k.length; }
  clear(): void { this.k.length = 0; this.v.length = 0; }
  private less(i: number, j: number): boolean {
    return this.k[i]! < this.k[j]! || (this.k[i] === this.k[j] && this.v[i]! < this.v[j]!);
  }
  private swap(i: number, j: number): void {
    const a = this.k[i]!, b = this.v[i]!;
    this.k[i] = this.k[j]!; this.v[i] = this.v[j]!;
    this.k[j] = a; this.v[j] = b;
  }
  push(key: number, val: number): void {
    let i = this.k.length;
    this.k.push(key); this.v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  /** Retire le minimum ; son coût est dans `topKey`. */
  topKey = 0;
  pop(): number {
    const val = this.v[0]!;
    this.topKey = this.k[0]!;
    const lk = this.k.pop()!, lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.k.length && this.less(l, m)) m = l;
        if (r < this.k.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return val;
  }
}

const heap = new Heap();
let dist = new Float64Array(0);
let prev = new Int32Array(0);
let prevXw = new Int32Array(0);

export interface PedStart { node: number; cost: number }

/** Chemin à pied depuis un point (rattaché au graphe par `starts`) jusqu'à la porte d'un bâtiment. */
export function pedPath(city: City, starts: PedStart[], sx: number, sy: number, from: number, to: Building): Walk | null {
  const n = city.pedX.length;
  if (dist.length < n) { dist = new Float64Array(n); prev = new Int32Array(n); prevXw = new Int32Array(n); }
  dist.fill(Infinity, 0, n);
  heap.clear();
  for (const s of starts) {
    if (s.cost < dist[s.node]!) { dist[s.node] = s.cost; prev[s.node] = -1; prevXw[s.node] = -1; heap.push(s.cost, s.node); }
  }
  let doneA = false, doneB = false;
  while (heap.size && !(doneA && doneB)) {
    const u = heap.pop();
    if (heap.topKey > dist[u]!) continue;
    if (u === to.pedA) doneA = true;
    if (u === to.pedB) doneB = true;
    for (const l of city.pedAdj[u]!) {
      const d = dist[u]! + l.len;
      if (d < dist[l.to]!) { dist[l.to] = d; prev[l.to] = u; prevXw[l.to] = l.xw; heap.push(d, l.to); }
    }
  }
  const ca = dist[to.pedA]! + to.pedDa;
  const cb = dist[to.pedB]! + (to.pedLen - to.pedDa);
  if (ca === Infinity && cb === Infinity) return null;
  const chain: number[] = [];
  for (let u = ca <= cb ? to.pedA : to.pedB; u !== -1; u = prev[u]!) chain.push(u);
  chain.reverse();
  const w: Walk = { pts: [sx, sy], nodes: [-1], xw: [-1], i: 1, from, to: to.id };
  for (let k = 0; k < chain.length; k++) {
    const u = chain[k]!;
    w.pts.push(city.pedX[u]!, city.pedY[u]!);
    w.nodes.push(u);
    w.xw.push(k + 1 < chain.length ? prevXw[chain[k + 1]!]! : -1);
  }
  w.pts.push(to.doorX, to.doorY);
  w.nodes.push(-1);
  return w;
}

/** Chemin de porte à porte. */
export function walkBetween(city: City, a: Building, b: Building): Walk {
  if (a.pedA === b.pedA && a.pedB === b.pedB)
    return { pts: [a.doorX, a.doorY, b.doorX, b.doorY], nodes: [-1, -1], xw: [-1], i: 1, from: a.id, to: b.id };
  return pedPath(city, [{ node: a.pedA, cost: a.pedDa }, { node: a.pedB, cost: a.pedLen - a.pedDa }], a.doorX, a.doorY, a.id, b)
    ?? { pts: [a.doorX, a.doorY, b.doorX, b.doorY], nodes: [-1, -1], xw: [-1], i: 1, from: a.id, to: b.id };
}

// ----------------------------------------------------------------- voitures

let eDist = new Float64Array(0);
let ePrev = new Int32Array(0);

export interface CarRoute { route: number[]; destS: number }

/**
 * Itinéraire en voiture. `starts` : arêtes de départ possibles et abscisse.
 * But : l'une des deux voies du tronçon du bâtiment, à l'abscisse de son accès.
 */
export function carRoute(world: World, starts: [number, number][], goalE: [number, number], goalS: [number, number]): CarRoute | null {
  const { city, rt } = world;
  const n = city.edges.length;
  if (eDist.length < n) { eDist = new Float64Array(n); ePrev = new Int32Array(n); }
  eDist.fill(Infinity, 0, n);
  heap.clear();
  let best = Infinity, bestE = -1, bestS = 0, bestPrev = -1;
  for (const [e, s] of starts) {
    const ed = city.edges[e]!;
    // Même voie, but devant : trajet direct.
    for (let g = 0; g < 2; g++)
      if (goalE[g] === e && goalS[g]! >= s - 0.01) {
        const c = (goalS[g]! - s) / ed.speed;
        if (c < best) { best = c; bestE = e; bestS = goalS[g]!; bestPrev = -1; }
      }
    const c = (ed.len - s) / ed.speed;
    if (c < eDist[e]!) { eDist[e] = c; ePrev[e] = -1; heap.push(c, e); }
  }
  // eDist[e] = coût pour atteindre la FIN de l'arête e.
  while (heap.size) {
    const e = heap.pop();
    if (heap.topKey > eDist[e]!) continue;
    if (heap.topKey >= best) break;
    const ed = city.edges[e]!;
    const node = city.nodes[ed.to]!;
    const nodeCost = (node.control === 'lights' ? 6 : node.control === 'priority' && (ed.dir & 1) !== node.major ? 4 : 1) + (rt.nodeBlocked[node.id] ? 900 : 0);
    for (let d = 0; d < 4; d++) {
      const o = node.out[d]!;
      if (o < 0 || o === ed.rev) continue;
      const od = city.edges[o]!;
      const enter = eDist[e]! + nodeCost + (rt.edgeBlocked[o] ? 900 : 0) + rt.edgeCars[o]!.length * 2.2;
      for (let g = 0; g < 2; g++)
        if (goalE[g] === o) {
          const c = enter + goalS[g]! / od.speed;
          if (c < best) { best = c; bestE = o; bestS = goalS[g]!; bestPrev = e; }
        }
      const c = enter + od.len / od.speed;
      if (c < eDist[o]!) { eDist[o] = c; ePrev[o] = e; heap.push(c, o); }
    }
  }
  if (bestE < 0) return null;
  const route: number[] = [bestE];
  for (let e = bestPrev, guard = 0; e !== -1 && guard < n + 2; e = ePrev[e]!, guard++) route.push(e);
  route.reverse();
  return { route, destS: bestS };
}

export function buildingStarts(b: Building): [number, number][] {
  return [[b.edges[0], b.edgeS[0]], [b.edges[1], b.edgeS[1]]];
}

/** Distance de Manhattan entre deux bâtiments (portes). */
export function tileDist(a: Building, b: Building): number {
  return Math.abs(a.ax - b.ax) + Math.abs(a.ay - b.ay);
}
