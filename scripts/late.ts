import { createWorld, step, clockText } from '../src/sim';
import { tileDist } from '../src/sim/path';
const w = createWorld(Number(process.argv[2] ?? 2026));
for (let i = 0; i < 2400; i++) step(w);
const B = w.city.buildings;
const rows: string[] = [];
const lates: number[] = [];
for (const p of w.state.people) {
  const j = p.journal.find((x) => x.s.includes('de retard'));
  if (!j) continue;
  const m = Number(/(\d+) min/.exec(j.s)![1]);
  lates.push(m);
  if (rows.length < 14) rows.push(`${p.first} ${p.role} ${p.age}a punct ${p.traits.punct.toFixed(2)} energy ${p.traits.energy.toFixed(2)} dist ${tileDist(B[p.home]!, B[p.work]!)} voiture ${p.car >= 0} début ${Math.floor(p.shiftStart / 60)}:${p.shiftStart % 60} retard ${m} à ${clockText(j.t)}`);
}
lates.sort((a, b) => a - b);
console.log('retards', lates.length, 'médiane', lates[lates.length >> 1], 'p90', lates[Math.floor(lates.length * 0.9)], 'max', lates[lates.length - 1]);
console.log(rows.join('\n'));
