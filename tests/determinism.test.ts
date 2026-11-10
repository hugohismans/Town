import { describe, expect, it } from 'vitest';
import { createWorld, hashState, restore, snapshot, step, submit, type Command, type World } from '../src/sim';

/** Une liste de commandes fixée d'avance, comme si un serveur les avait ordonnées. */
function script(world: World): Command[] {
  const P = world.state.people;
  const B = world.city.buildings;
  const cafe = world.city.byKind['cafe']![0]!;
  const park = world.city.byKind['park']![0]!;
  const cmds: Command[] = [];
  const add = (tick: number, type: Command['type'], targetId: number, params: Command['params'] = {}) =>
    cmds.push({ tick, playerId: cmds.length % 2 ? 'ada' : 'bob', type, targetId, params });
  for (let k = 0; k < 60; k++) {
    const t = 300 + k * 150;
    const id = (k * 37) % P.length;
    switch (k % 10) {
      case 0: add(t, 'goto', id, { buildingId: cafe }); break;
      case 1: add(t, 'whisper', id, { need: 'hunger' }); break;
      case 2: add(t, 'distract', id); break;
      case 3: add(t, 'cheer', id); break;
      case 4: add(t, 'meet', id, { personId: (id + 11) % P.length }); break;
      case 5: add(t, 'rumor', id, { buildingId: park }); break;
      case 6: add(t, 'hurry', id); break;
      case 7: add(t, 'skipWork', id); break;
      case 8: add(t, 'visit', id, { personId: (id + 5) % P.length }); break;
      default: add(t, 'goHome', id); break;
    }
  }
  // Quelques commandes invalides : elles doivent être rejetées de la même façon partout.
  add(500, 'goto', 99999, { buildingId: cafe });
  add(650, 'goto', 3, { buildingId: B.length + 50 });
  return cmds;
}

function run(seed: number, ticks: number): World {
  const w = createWorld(seed);
  for (const c of script(w)) submit(w, c);
  for (let i = 0; i < ticks; i++) step(w);
  return w;
}

describe('déterminisme', () => {
  it('même graine + mêmes commandes = même hash après 10 000 ticks', () => {
    const a = run(2026, 10000);
    const b = run(2026, 10000);
    expect(hashState(a)).toBe(hashState(b));
    // Les commandes ont bien eu un effet (sinon le test ne prouverait rien).
    expect(a.state.feedback.length).toBeGreaterThan(0);
    expect(Object.keys(a.state.players).sort()).toEqual(['ada', 'bob']);
    expect(a.state.tick).toBe(10000);
  });

  it('une graine différente ou une commande en plus change le hash', () => {
    const base = run(2026, 1500);
    expect(hashState(run(2027, 1500))).not.toBe(hashState(base));
    const w = createWorld(2026);
    for (const c of script(w)) submit(w, c);
    submit(w, { tick: 400, playerId: 'zoe', type: 'whisper', targetId: 7, params: { need: 'fatigue' } });
    for (let i = 0; i < 1500; i++) step(w);
    expect(hashState(w)).not.toBe(hashState(base));
  });

  it('snapshot puis restauration : la suite est identique', () => {
    const straight = run(7, 5000);
    const w = createWorld(7);
    for (const c of script(w)) submit(w, c);
    for (let i = 0; i < 2600; i++) step(w);
    const copy = restore(snapshot(w));
    expect(hashState(copy)).toBe(hashState(w));
    for (let i = 0; i < 2400; i++) step(copy);
    expect(hashState(copy)).toBe(hashState(straight));
  });
});
