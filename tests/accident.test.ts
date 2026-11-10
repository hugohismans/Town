import { describe, expect, it } from 'vitest';
import { CAR_DRIVING, CAR_LEN, COSTS, createWorld, player, step, submit, type World } from '../src/sim';

/** Conducteur lancé alors qu'une voiture est arrêtée juste devant lui : le pire moment pour être distrait. */
function riskyDriver(w: World): number {
  const C = w.state.cars;
  let best = -1, bestV = 0;
  for (const list of w.rt.edgeCars) {
    for (let k = 1; k < list.length; k++) {
      const car = C[list[k]!]!, lead = C[list[k - 1]!]!;
      if (car.st !== CAR_DRIVING || car.owner < 0 || car.kind !== 0) continue;
      const gap = lead.s - CAR_LEN - car.s;
      const p = w.state.people[car.owner]!;
      if (lead.v < 0.02 && car.v > 0.13 && gap > 0.5 && gap < 2.2 && car.v > bestV && w.state.tick >= p.cooldownUntil) { best = car.owner; bestV = car.v; }
    }
  }
  return best;
}

describe('distraction au volant', () => {
  it('peut provoquer un accident, avec secours, blocage et traces', () => {
    const w = createWorld(2026);
    const me = 'esprit-test';
    let sent = 0;
    // On distrait des conducteurs à l'heure de pointe, dans la limite de la jauge d'influence.
    for (let i = 0; i < 4200 && !w.state.accidents.some((a) => a.by === me); i++) {
      step(w);
      if (player(w, me).influence < COSTS.distract) continue;
      const target = riskyDriver(w);
      if (target >= 0) { submit(w, { tick: w.state.tick + 1, playerId: me, type: 'distract', targetId: target, params: {} }); sent++; }
    }
    const acc = w.state.accidents.find((a) => a.by === me);
    expect(sent).toBeGreaterThan(0);
    expect(acc, `aucun accident après ${sent} distractions`).toBeDefined();
    if (!acc) return;
    // L'accident est attribué au conducteur distrait et raconté dans la chronique.
    expect(acc.cause).toBeGreaterThanOrEqual(0);
    expect(w.state.chronicle.some((e) => e.kind === 'accident' && e.by === me)).toBe(true);
    expect(w.state.people[acc.cause]!.journal.some((j) => j.s.includes('accident'))).toBe(true);
    // Les véhicules restent sur place et bloquent la voie tant que les secours n'ont pas fini.
    expect(acc.open).toBe(true);
    expect(acc.cars.length).toBeGreaterThan(0);
    const t0 = w.state.tick;
    while (acc.open && w.state.tick < t0 + 1300) step(w);
    expect(acc.open).toBe(false);
    expect(w.state.chronicle.some((e) => e.kind === 'rescue' && e.t > t0)).toBe(true);
    // Les blessés sont à l'hôpital (ou en route), jamais oubliés sur la chaussée.
    for (const id of acc.injured) {
      const p = w.state.people[id]!;
      expect(p.act === 'hospital' || p.loc === 4).toBe(true);
    }
  });

  it("sans distraction, personne n'a d'accident parmi les conducteurs attentifs", () => {
    // Les accidents ne naissent que d'une inattention : chacun doit avoir un responsable.
    const w = createWorld(11);
    for (let i = 0; i < 6000; i++) step(w);
    for (const a of w.state.accidents) expect(a.cause).toBeGreaterThanOrEqual(0);
  });
});
