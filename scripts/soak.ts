// Endurance : une semaine de ville, avec un esprit qui s'amuse, puis recherche de tout ce qui serait coincé.
import { createWorld, step, submit, clockText, player, DAY_NAMES, weekday, type CommandType } from '../src/sim';
const seed = Number(process.argv[2] ?? 2026);
const days = Number(process.argv[3] ?? 7);
const w = createWorld(seed);
const S = w.state;
let shown = 0;
const kinds: CommandType[] = ['rumor', 'meet', 'distract', 'goto', 'visit', 'hurry', 'whisper', 'cheer', 'skipWork', 'goHome'];
let k = 0;
const verbose = process.argv[4] === 'v';
for (let i = 0; i < 7200 * days; i++) {
  step(w);
  if (i % 97 === 0 && player(w, 'moi').influence >= 35) {
    const type = kinds[k++ % kinds.length]!;
    const out = S.people.filter((p) => p.loc === 1 || p.loc === 2);
    const p = out.length ? out[(i * 7) % out.length]! : S.people[(i * 13) % S.people.length]!;
    const o = S.people[(p.id + 17 + i) % S.people.length]!;
    const cafes = w.city.byKind['cafe']!;
    submit(w, { tick: S.tick + 1, playerId: 'moi', type, targetId: p.id, params: { buildingId: cafes[i % cafes.length], personId: o.id, need: 'fatigue' } });
  }
  while (shown < S.chronicle.length) {
    const ev = S.chronicle[shown++]!;
    if (verbose || ev.kind === 'rumor' || ev.kind === 'spirit' || ev.kind === 'love' || (ev.kind === 'day' && ev.text.startsWith('Minuit'))) console.log(DAY_NAMES[weekday(ev.t)]!.slice(0, 3), clockText(ev.t), ev.by ? '✦' : ' ', ev.text);
  }
}
const stuckCars = S.cars.filter((c) => c.st === 2 && c.wait > 300).length;
const crashed = S.cars.filter((c) => c.st === 3).length;
const ghostDrivers = S.people.filter((p) => p.loc === 2 && (p.car < 0 || ![1, 2, 3].includes(S.cars[p.car]!.st))).length;
const down = S.people.filter((p) => p.loc === 3 || p.loc === 4).length;
const lostWalkers = S.people.filter((p) => p.loc === 1 && !p.walk).length;
const openAcc = S.accidents.filter((a) => a.open).length;
const farCars = S.cars.filter((c) => c.owner >= 0 && c.st === 0 && c.at !== S.people[c.owner]!.home && S.people[c.owner]!.loc === 0 && S.people[c.owner]!.at === S.people[c.owner]!.home).length;
const fb = S.feedback.filter((f) => f.playerId === 'moi');
console.log({ stuckCars, crashed, ghostDrivers, down, lostWalkers, openAcc, farCars, rels: (S.people.reduce((a, p) => a + p.rel.length, 0) / S.people.length).toFixed(1), couples: S.people.filter((p) => p.partner >= 0).length / 2, queue: S.queue.length, derniersRetours: fb.slice(-4).map((f) => (f.ok ? '✓ ' : '✗ ') + f.text) });
