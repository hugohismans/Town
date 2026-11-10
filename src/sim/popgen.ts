// Population : foyers, emplois, relations, voitures. Fonction pure de la graine.

import { CAR_WALK_LIMIT, TICKS_PER_MIN, WALK_SPEED } from './constants';
import * as N from './names';
import { tileDist, walkBetween } from './path';
import { Rng } from './rng';
import {
  CAR_PARKED, LOC_IN,
  type Building, type Car, type Person, type RelKind, type World,
} from './types';

export const POP_TARGET = 420;
const WEEKEND = (1 << 5) | (1 << 6);

interface Slot { b: number; start: number; end: number; title: string; off: number }

function jobSlots(b: Building, rng: Rng): Slot[] {
  const out: Slot[] = [];
  const two = (k: number) => { const a = k % 7; const c = (a + 1 + ((k >> 3) % 5)) % 7; return (1 << a) | (1 << c); };
  for (let i = 0; i < b.jobs; i++) {
    const h = b.variant + i * 31;
    switch (b.kind) {
      case 'office': {
        const start = 480 + ((b.variant >>> 3) % 4) * 15 + rng.pick([0, 0, 15, 30, 45]);
        out.push({ b: b.id, start, end: start + 510, title: i === 0 ? 'directeur' : rng.pick(N.OFFICE_JOBS), off: WEEKEND });
        break;
      }
      case 'shop': {
        const t = N.SHOPS[b.variant % N.SHOPS.length]!;
        const start = i === 0 ? b.openFrom - 15 : b.openFrom + 150;
        out.push({ b: b.id, start, end: i === 0 ? start + 480 : b.openTo + 15, title: i === 0 ? t[1] : 'vendeur', off: (1 << 6) | (1 << (h % 5)) });
        break;
      }
      case 'cafe':
        out.push({ b: b.id, start: [405, 660, 840][i % 3]!, end: [900, 1140, 1335][i % 3]!, title: 'serveur', off: two(h) });
        break;
      case 'restaurant':
        out.push({ b: b.id, start: i % 2 ? 900 : 630, end: i % 2 ? 1395 : 1110, title: i < 2 ? 'cuisinier' : 'serveur', off: two(h) });
        break;
      case 'bar':
        out.push({ b: b.id, start: 1005, end: 1575, title: 'barman', off: two(h) });
        break;
      case 'hospital':
        out.push({ b: b.id, start: [360, 840, 1320][i % 3]!, end: [855, 1335, 1815][i % 3]!, title: ['infirmier', 'médecin', 'aide-soignant', 'ambulancier', 'infirmier', 'médecin'][i % 6]!, off: two(h) });
        break;
      case 'school':
        out.push({ b: b.id, start: 465, end: 1005, title: i % 2 ? 'professeur' : 'instituteur', off: WEEKEND });
        break;
      case 'townhall':
        out.push({ b: b.id, start: 510, end: 1035, title: i === 0 ? 'maire' : 'agent municipal', off: WEEKEND });
        break;
      case 'cinema':
        out.push({ b: b.id, start: 765, end: 1455, title: i === 0 ? 'projectionniste' : 'ouvreur', off: two(h) });
        break;
      case 'garage':
        out.push({ b: b.id, start: i % 2 ? 570 : 450, end: i % 2 ? 1110 : 990, title: i % 2 ? 'dépanneur' : 'mécanicien', off: (1 << 6) | (1 << (h % 5)) });
        break;
      default:
        break;
    }
  }
  return out;
}

export function populate(world: World): void {
  const { city, state } = world;
  const rng = new Rng(state.seed ^ 0x7f4a7c15);
  const people: Person[] = [];
  const B = city.buildings;

  const mk = (home: number, age: number, female: boolean, last: string): Person => {
    const id = people.length;
    const p: Person = {
      id, first: rng.pick(female ? N.FIRST_F : N.FIRST_M), last, female, age, home, work: -1,
      role: age < 18 ? 'student' : age >= 65 ? 'retired' : 'idle', job: '', shiftStart: 0, shiftEnd: 0, daysOff: 0, commute: 0, depart: 0,
      traits: {
        soc: rng.range(0.1, 1), punct: rng.range(0.15, 1), care: rng.range(0.25, 1),
        stub: rng.range(0.05, 0.95), energy: rng.range(0.2, 1), curio: rng.range(0.1, 1),
      },
      needs: { hunger: rng.range(0.35, 0.55), fatigue: rng.range(0.03, 0.2), social: rng.range(0.15, 0.5), fun: rng.range(0.15, 0.5) },
      mood: rng.range(0.55, 0.78), rel: [], partner: -1, car: -1, look: (rng.next() * 4294967296) >>> 0,
      loc: LOC_IN, at: home, x: B[home]!.doorX, y: B[home]!.doorY, walk: null,
      act: 'sleep', dest: home, doing: true, until: 0, think: 1 + (id % 40), goal: null, rumor: null,
      wait: 0, xw: -1, chatWith: -1, chatUntil: 0, lastPass: -1, watch: -1, watched: -1, watchUntil: 0,
      distractUntil: 0, distractBy: '', hurryUntil: 0, shockUntil: 0, cooldownUntil: 0,
      skipDay: -1, lunchDay: -1, lateDay: -1, workedDay: -1, delayBy: -1, injured: false, journal: [],
    };
    people.push(p);
    return p;
  };
  const rel = (a: Person, b: Person, kind: RelKind, aff: number) => {
    if (a.id === b.id || a.rel.some((r) => r.id === b.id)) return;
    a.rel.push({ id: b.id, kind, aff });
    b.rel.push({ id: a.id, kind, aff });
  };

  // ---------------------------------------------------------------- foyers
  const units: number[] = [];
  for (const b of B) for (let u = 0; u < b.units; u++) units.push(b.id);
  rng.shuffle(units);
  const households: Person[][] = [];
  for (const home of units) {
    if (people.length >= POP_TARGET) break;
    const apt = B[home]!.kind === 'apartment';
    let size = [1, 1, 1, 2, 2, 2, 2, 3, 3, 4, 4, 5][rng.int(12)]!;
    if (apt && size > 3) size = 3;
    const last = rng.pick(N.LAST);
    const hh: Person[] = [];
    const r = rng.next();
    if (size === 1) {
      hh.push(mk(home, rng.chance(0.3) ? rng.between(66, 88) : rng.between(20, 64), rng.chance(0.5), last));
    } else if (size === 2 && r < 0.15) {
      const parent = mk(home, rng.between(30, 50), rng.chance(0.6), last);
      const kid = mk(home, rng.between(6, 17), rng.chance(0.5), last);
      rel(parent, kid, 'family', rng.range(0.7, 0.92));
      hh.push(parent, kid);
    } else if ((size === 2 && r < 0.3) || (size === 3 && r < 0.2)) {
      // Colocation.
      for (let i = 0; i < size; i++) hh.push(mk(home, rng.between(20, 33), rng.chance(0.5), rng.pick(N.LAST)));
      for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) rel(hh[i]!, hh[j]!, 'friend', rng.range(0.45, 0.75));
    } else {
      const old = size === 2 && rng.chance(0.3);
      const age = old ? rng.between(66, 84) : size === 2 ? rng.between(24, 62) : rng.between(31, 52);
      const fa = rng.chance(0.5);
      const a = mk(home, age, fa, last);
      const b = mk(home, Math.max(20, age + rng.between(-6, 6)), rng.chance(0.92) ? !fa : fa, rng.chance(0.7) ? last : rng.pick(N.LAST));
      rel(a, b, 'partner', rng.range(0.78, 0.96));
      a.partner = b.id;
      b.partner = a.id;
      hh.push(a, b);
      for (let i = 2; i < size; i++) {
        const kid = mk(home, rng.between(6, Math.min(17, Math.max(6, Math.min(a.age, b.age) - 22))), rng.chance(0.5), last);
        rel(a, kid, 'family', rng.range(0.7, 0.92));
        rel(b, kid, 'family', rng.range(0.7, 0.92));
        for (let j = 2; j < i; j++) rel(hh[j]!, kid, 'family', rng.range(0.55, 0.85));
        hh.push(kid);
      }
    }
    households.push(hh);
    state.pantry[home] = (state.pantry[home] ?? 0) + 6 + hh.length * 4 + rng.between(0, 6);
  }

  // ---------------------------------------------------------------- emplois
  const slots: Slot[] = [];
  for (const b of B) slots.push(...jobSlots(b, rng));
  rng.shuffle(slots);
  const schools = city.byKind['school'] ?? [];
  const workers = rng.shuffle(people.filter((p) => p.age >= 18 && p.age < 65));
  let si = 0;
  for (const p of workers) {
    if (si >= slots.length || rng.chance(0.07)) { p.job = 'sans emploi'; continue; }
    const s = slots[si++]!;
    p.role = 'worker';
    p.work = s.b;
    p.shiftStart = s.start;
    p.shiftEnd = s.end;
    p.daysOff = s.off;
    p.job = N.jobTitle(s.title, p.female);
  }
  for (const p of people) {
    if (p.role === 'retired') p.job = N.jobTitle('retraité', p.female);
    if (p.role !== 'student') continue;
    let best = schools[0] ?? -1;
    for (const s of schools) if (best < 0 || tileDist(B[s]!, B[p.home]!) < tileDist(B[best]!, B[p.home]!)) best = s;
    p.work = best;
    p.shiftStart = 505 + rng.pick([0, 0, 5, 10]);
    p.shiftEnd = 975;
    p.daysOff = WEEKEND;
    p.job = N.jobTitle(p.age < 11 ? 'écolier' : p.age < 15 ? 'collégien' : 'lycéen', p.female);
  }

  // ---------------------------------------------------------------- relations
  const byWork = new Map<number, Person[]>();
  for (const p of people) if (p.work >= 0) (byWork.get(p.work) ?? byWork.set(p.work, []).get(p.work)!).push(p);
  for (const [, group] of [...byWork.entries()].sort((a, b) => a[0] - b[0])) {
    for (const p of group) {
      const n = Math.min(group.length - 1, p.role === 'student' ? 2 : 3);
      for (let k = 0; k < n; k++) {
        const o = rng.pick(group);
        if (p.role === 'student' && o.role === 'student' && Math.abs(o.age - p.age) <= 2) rel(p, o, 'friend', rng.range(0.5, 0.85));
        else if (p.role !== 'student' && o.role !== 'student') rel(p, o, 'colleague', rng.range(0.3, 0.62));
      }
    }
  }
  const adults = people.filter((p) => p.age >= 18);
  for (const p of adults) {
    const n = 1 + rng.int(3);
    for (let k = 0; k < n; k++) {
      const o = rng.pick(adults);
      if (o.home !== p.home && Math.abs(o.age - p.age) <= 12) rel(p, o, 'friend', rng.range(0.5, 0.88));
    }
  }
  for (let i = 0; i < households.length; i++) {
    const a = households[i]![0]!;
    for (let k = 0; k < 6; k++) {
      const b = rng.pick(households)[0]!;
      if (b.home !== a.home && tileDist(B[a.home]!, B[b.home]!) <= 3) rel(a, b, 'neighbor', rng.range(0.25, 0.55));
    }
  }

  // ---------------------------------------------------------------- voitures
  const cars: Car[] = [];
  const mkCar = (owner: number, kind: 0 | 1 | 2, at: number): Car => {
    const c: Car = {
      id: cars.length, owner, kind, color: rng.int(12), st: CAR_PARKED, at, e: 0, s: 0, v: 0, node: -1, mv: -1,
      route: [], ri: 0, destB: -1, destS: 0, wait: 0, blind: -9999, siren: false, job: -1, until: 0,
    };
    cars.push(c);
    return c;
  };
  for (const p of adults) {
    const far = p.work >= 0 && tileDist(B[p.home]!, B[p.work]!) > CAR_WALK_LIMIT;
    if (rng.chance(far ? 0.55 : p.role === 'retired' ? 0.2 : 0.12)) p.car = mkCar(p.id, 0, p.home).id;
  }
  // Chacun connaît à peu près son temps de trajet (détour par les ponts compris).
  for (const p of people) {
    if (p.work < 0) continue;
    const w = walkBetween(city, B[p.home]!, B[p.work]!);
    let len = 0;
    for (let i = 2; i < w.pts.length; i += 2) len += Math.abs(w.pts[i]! - w.pts[i - 2]!) + Math.abs(w.pts[i + 1]! - w.pts[i - 1]!);
    const speed = WALK_SPEED * (0.8 + 0.4 * p.traits.energy) * (p.age > 70 ? 0.72 : p.age < 12 ? 0.85 : 1);
    const drives = p.car >= 0 && tileDist(B[p.home]!, B[p.work]!) > CAR_WALK_LIMIT;
    p.commute = Math.round((drives ? (len / 0.2) * 1.5 + 45 : (len / speed) * 1.08 + 20) / TICKS_PER_MIN);
  }
  for (let i = 0; i < 2; i++) mkCar(-1, 1, city.hospital);
  for (let i = 0; i < 2; i++) mkCar(-1, 2, city.garage);

  state.people = people;
  state.cars = cars;
}
