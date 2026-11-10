import { describe, expect, it } from 'vitest';
import { COSTS, INFLUENCE_MAX, createWorld, player, snapshot, step, submit, type World } from '../src/sim';

const last = (w: World) => w.state.feedback[w.state.feedback.length - 1]!;

describe('commandes et influence', () => {
  it('une commande coûte de l\'influence, qui se recharge avec le temps', () => {
    const w = createWorld(5);
    for (let i = 0; i < 400; i++) step(w);
    const before = player(w, 'ada').influence;
    submit(w, { tick: w.state.tick + 1, playerId: 'ada', type: 'cheer', targetId: 10, params: {} });
    step(w);
    expect(last(w).ok).toBe(true);
    expect(player(w, 'ada').influence).toBe(before - COSTS.cheer);
    for (let i = 0; i < 2000; i++) step(w);
    expect(player(w, 'ada').influence).toBe(INFLUENCE_MAX);
  });

  it('refuse sans rien modifier quand la jauge est vide, la cible inconnue ou sollicitée trop tôt', () => {
    const w = createWorld(5);
    for (let i = 0; i < 400; i++) step(w);
    player(w, 'ada').influence = 5;
    const mood = w.state.people[10]!.mood;
    submit(w, { tick: w.state.tick + 1, playerId: 'ada', type: 'cheer', targetId: 10, params: {} });
    step(w);
    expect(last(w).ok).toBe(false);
    expect(player(w, 'ada').influence).toBeLessThanOrEqual(6);
    expect(Math.abs(w.state.people[10]!.mood - mood)).toBeLessThan(0.01);

    player(w, 'ada').influence = 100;
    submit(w, { tick: w.state.tick + 1, playerId: 'ada', type: 'cheer', targetId: 123456, params: {} });
    step(w);
    expect(last(w).ok).toBe(false);
    expect(player(w, 'ada').influence).toBeGreaterThanOrEqual(100 - 1);

    submit(w, { tick: w.state.tick + 1, playerId: 'ada', type: 'cheer', targetId: 10, params: {} });
    step(w);
    expect(last(w).ok).toBe(true);
    submit(w, { tick: w.state.tick + 1, playerId: 'bob', type: 'cheer', targetId: 10, params: {} });
    step(w);
    expect(last(w).ok).toBe(false); // garde-fou : un habitant ne peut pas être harcelé
    expect(last(w).playerId).toBe('bob');
  });

  it("une suggestion n'est qu'une suggestion : l'habitant marche lui-même, ou refuse", () => {
    const w = createWorld(5);
    for (let i = 0; i < 1900; i++) step(w); // vers midi
    const cafe = w.city.byKind['cafe']![0]!;
    let accepted = 0, refused = 0;
    for (let k = 0; k < 40; k++) {
      const p = w.state.people[k * 9]!;
      player(w, 'ada').influence = 100;
      const before = { x: p.x, y: p.y, loc: p.loc, at: p.at };
      submit(w, { tick: w.state.tick + 1, playerId: 'ada', type: 'goto', targetId: p.id, params: { buildingId: cafe } });
      step(w);
      const f = last(w);
      if (f.targetId !== p.id) continue;
      if (f.ok) {
        accepted++;
        expect(p.goal?.dest).toBe(cafe);
        // Pas de téléportation : s'il était dehors il n'a fait qu'un pas, sinon il sort par sa porte.
        if (before.loc === 1) expect(Math.abs(p.x - before.x) + Math.abs(p.y - before.y)).toBeLessThan(0.3);
        expect(p.loc === 0 && p.at === cafe && before.at !== cafe).toBe(false);
      } else refused++;
    }
    expect(accepted).toBeGreaterThan(3);
    expect(refused).toBeGreaterThan(0);
  });

  it('les commandes en attente font partie du snapshot', () => {
    const w = createWorld(5);
    submit(w, { tick: 500, playerId: 'ada', type: 'cheer', targetId: 3, params: {} });
    expect(JSON.parse(snapshot(w)).queue).toHaveLength(1);
  });
});
