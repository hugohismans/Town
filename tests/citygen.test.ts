import { describe, expect, it } from 'vitest';
import { generateCity, isRoadTile } from '../src/sim/citygen';

describe('génération de la ville', () => {
  it('est une fonction pure de la graine', () => {
    const a = generateCity(7);
    const b = generateCity(7);
    expect(JSON.stringify(a.buildings)).toBe(JSON.stringify(b.buildings));
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(generateCity(8).name + generateCity(8).buildings.length).not.toBe(a.name + a.buildings.length + 'x');
  });

  it.each([1, 2, 3, 42, 2026])('graine %i : réseau connexe, sans impasse, chaque bâtiment desservi', (seed) => {
    const c = generateCity(seed);
    // Aucun cul-de-sac : chaque carrefour a au moins deux branches.
    for (const n of c.nodes) expect(n.deg).toBeGreaterThanOrEqual(2);
    // Toutes les arêtes sont atteignables depuis la première.
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      const e = c.edges[stack.pop() as number]!;
      for (const o of c.nodes[e.to]!.out) if (o >= 0 && !seen.has(o)) { seen.add(o); stack.push(o); }
    }
    expect(seen.size).toBe(c.edges.length);
    // Graphe piéton connexe.
    const ps = new Set<number>([0]);
    const st = [0];
    while (st.length) for (const l of c.pedAdj[st.pop() as number]!) if (!ps.has(l.to)) { ps.add(l.to); st.push(l.to); }
    expect(ps.size).toBe(c.pedX.length);
    for (const b of c.buildings) {
      expect(isRoadTile(c.tiles[b.ay * c.w + b.ax] as number)).toBe(true);
      expect(c.nodeAt[b.ay * c.w + b.ax]).toBe(-1);
      expect(b.pedDa).toBeGreaterThan(0);
      expect(b.pedDa).toBeLessThan(b.pedLen);
      for (const k of [0, 1] as const) {
        expect(b.edgeS[k]).toBeGreaterThan(0);
        expect(b.edgeS[k]).toBeLessThan(c.edges[b.edges[k]]!.len);
      }
    }
    for (const kind of ['hospital', 'garage', 'school', 'townhall', 'cafe', 'bar', 'park']) expect(c.byKind[kind]?.length ?? 0).toBeGreaterThan(0);
  });
});
