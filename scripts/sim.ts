// Fait tourner la simulation hors navigateur et affiche ce qui s'y passe.
import { createWorld, step, hashState, clockText, minuteOfDay } from '../src/sim';
const seed = Number(process.argv[2] ?? 2026);
const ticks = Number(process.argv[3] ?? 7200);
const t0 = performance.now();
const w = createWorld(seed);
console.log(w.city.name, 'habitants', w.state.people.length, 'voitures', w.state.cars.length, `(création ${(performance.now() - t0).toFixed(0)} ms)`);
const roles: Record<string, number> = {};
for (const p of w.state.people) roles[p.role] = (roles[p.role] ?? 0) + 1;
console.log(JSON.stringify(roles), 'avec voiture', w.state.people.filter((p) => p.car >= 0).length);
let shown = 0;
const t1 = performance.now();
for (let i = 0; i < ticks; i++) {
  step(w);
  if (i % 300 === 299) {
    const acts: Record<string, number> = {};
    let walk = 0, drive = 0, inn = 0;
    for (const p of w.state.people) {
      if (p.loc === 0) inn++; else if (p.loc === 1) walk++; else if (p.loc === 2) drive++;
      const k = (p.doing ? '' : '>') + p.act;
      acts[k] = (acts[k] ?? 0) + 1;
    }
    const cars = w.state.cars.filter((c) => c.st === 2).length;
    const stuck = w.state.cars.filter((c) => c.st === 2 && c.wait > 60).length;
    console.log(clockText(w.state.tick), `int ${inn} pied ${walk} auto ${drive} (roulent ${cars}, coincées ${stuck})`, JSON.stringify(acts));
  }
  while (shown < w.state.chronicle.length) { const ev = w.state.chronicle[shown++]!; console.log('   ✦', clockText(ev.t), ev.text); }
}
const dt = performance.now() - t1;
console.log(`${ticks} ticks en ${dt.toFixed(0)} ms (${(dt / ticks).toFixed(3)} ms/tick)`, 'hash', hashState(w), 'snapshot', (JSON.stringify(w.state).length / 1024).toFixed(0), 'ko', minuteOfDay(w.state.tick));
const n = w.state.people.reduce((a, p) => ({ h: a.h + p.needs.hunger, f: a.f + p.needs.fatigue, s: a.s + p.needs.social, l: a.l + p.needs.fun, m: a.m + p.mood }), { h: 0, f: 0, s: 0, l: 0, m: 0 });
const N = w.state.people.length;
console.log('moyennes faim', (n.h / N).toFixed(2), 'fatigue', (n.f / N).toFixed(2), 'social', (n.s / N).toFixed(2), 'loisir', (n.l / N).toFixed(2), 'humeur', (n.m / N).toFixed(2));
// Diagnostic : qui mange encore à 15 h ?
if (process.argv[4]) {
  const B = w.city.buildings;
  for (const p of w.state.people.filter((p) => p.act === process.argv[4]).slice(0, 8))
    console.log(p.first, p.role, p.age, 'doing', p.doing, 'loc', p.loc, 'at', B[p.at]!.kind, 'dest', B[p.dest]!.kind, 'faim', p.needs.hunger.toFixed(2), 'until', p.until - w.state.tick, 'think', p.think - w.state.tick, 'goal', JSON.stringify(p.goal), 'journal', p.journal.slice(-3).map((j) => j.s).join(' | '));
}
