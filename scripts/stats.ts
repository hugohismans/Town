import { generateCity } from '../src/sim/citygen';
for (const seed of [1, 2, 3, 42, 2026]) {
  const t = performance.now();
  const c = generateCity(seed);
  const kinds: Record<string, number> = {};
  let units = 0, jobs = 0;
  for (const b of c.buildings) { kinds[b.kind] = (kinds[b.kind] ?? 0) + 1; units += b.units; jobs += b.jobs; }
  const ctrl: Record<string, number> = {};
  for (const n of c.nodes) ctrl[n.control] = (ctrl[n.control] ?? 0) + 1;
  console.log(seed, c.name, `${(performance.now() - t).toFixed(0)}ms`, 'B', c.buildings.length, 'units', units, 'jobs', jobs, 'nodes', c.nodes.length, 'edges', c.edges.length, 'ped', c.pedX.length, 'trees', c.trees.length, 'lamps', c.lamps.length, JSON.stringify(kinds), JSON.stringify(ctrl));
}
const c = generateCity(42);
const ch = ['.', '#', 'o', 'P', '~', ',', ':', '='];
for (let y = 0; y < c.h; y++) { let s = ''; for (let x = 0; x < c.w; x++) { const k = y * c.w + x; const b = c.lot[k]; s += b >= 0 ? (c.buildings[b].kind[0]) : c.nodeAt[k] >= 0 ? '+' : ch[c.tiles[k]]; } console.log(s); }
