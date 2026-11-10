import { createWorld, step, clockText, minuteOfDay, dayIndex } from '../src/sim';
import { shiftNow, travelMinutes } from '../src/sim/people';
const w = createWorld(2026);
const p = w.state.people.find((p) => p.first === 'Léon' && p.age === 8)!;
for (let i = 0; i < 900; i++) {
  step(w);
  if (i % 50 === 0 && i > 200) {
    const m = minuteOfDay(w.state.tick);
    const lead = travelMinutes(w, p, p.at, p.work) + 12 + (p.traits.punct - 0.5) * 24;
    console.log(clockText(w.state.tick), p.act, 'doing', p.doing, 'loc', p.loc, 'think', p.think - w.state.tick, 'until', p.until - w.state.tick, 'lead', lead.toFixed(0), 'shift', JSON.stringify(shiftNow(p, m, dayIndex(w.state.tick), lead)), 'faim', p.needs.hunger.toFixed(2), 'fat', p.needs.fatigue.toFixed(2), 'start', p.shiftStart);
  }
}
