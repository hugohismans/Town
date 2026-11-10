// Les habitants : besoins, décisions (IA à utilité), marche, conversations.
// Personne n'est télécommandé : tout passe par decide().

import { at, chron, dePers, e, fullName, il, note } from './chronicle';
import { CARS_ENABLED, CAR_WALK_LIMIT, TICKS_PER_MIN, WALK_SPEED } from './constants';
import { pedPath, tileDist, walkBetween, type PedStart } from './path';
import type { Rng } from './rng';
import { canCross, redirectCar, startDrive } from './traffic';
import {
  CAR_PARKED, LOC_CAR, LOC_IN, LOC_WALK,
  type Act, type BKind, type Building, type Goal, type Person, type World,
} from './types';
import { dayIndex, minuteOfDay } from './world';

export function isOpen(b: Building, minute: number): boolean {
  if (b.openFrom === 0 && b.openTo === 1440) return true;
  return (minute >= b.openFrom && minute < b.openTo) || (b.openTo > 1440 && minute < b.openTo - 1440);
}

/** Attention du moment : 1 = vigilant, proche de 0 = ne regarde plus rien. */
export function attention(p: Person, tick: number): number {
  if (tick < p.distractUntil) return 0.03;
  const t = p.traits;
  return 0.72 + 0.28 * t.care - Math.max(0, p.needs.fatigue - 0.7) * 1.2 - (p.mood < 0.25 ? 0.08 : 0) - (tick < p.hurryUntil ? 0.14 : 0);
}

interface Shift { on: boolean; day: number; left: number; lateBy: number }

/** Est-ce l'heure d'être au travail (ou de s'y rendre) ? `lead` = minutes d'avance pour le trajet. */
function shiftNow(p: Person, minute: number, day: number, lead: number): Shift {
  const none: Shift = { on: false, day, left: 0, lateBy: 0 };
  if (p.work < 0) return none;
  const works = (d: number) => !(p.daysOff & (1 << (((d % 7) + 7) % 7)));
  if (works(day) && minute >= p.shiftStart - lead && minute < p.shiftEnd)
    return { on: true, day, left: p.shiftEnd - minute, lateBy: minute - p.shiftStart };
  if (p.shiftEnd > 1440 && works(day - 1) && minute < p.shiftEnd - 1440)
    return { on: true, day: day - 1, left: p.shiftEnd - 1440 - minute, lateBy: minute + 1440 - p.shiftStart };
  return none;
}

function wantsCar(world: World, p: Person, from: number, dest: number): boolean {
  if (!CARS_ENABLED || p.car < 0 || p.age < 18) return false;
  const car = world.state.cars[p.car]!;
  if (car.st !== CAR_PARKED || car.at !== from) return false;
  const B = world.city.buildings;
  const d = tileDist(B[from]!, B[dest]!);
  if (d > CAR_WALK_LIMIT) return true;
  if (dest === p.home && d > 2) return true; // on ne rentre pas sans elle
  // On ne laisse pas la voiture derrière soi si l'on ne revient pas (sauf pause déjeuner).
  return d > 3 && p.act !== 'eatOut' && tileDist(B[dest]!, B[p.home]!) > CAR_WALK_LIMIT && from !== p.home;
}

/** Temps de trajet estimé, en minutes de ville. */
function travelMinutes(world: World, p: Person, from: number, dest: number): number {
  const B = world.city.buildings;
  const d = tileDist(B[from]!, B[dest]!);
  const walk = WALK_SPEED * (0.8 + 0.4 * p.traits.energy) * (p.age > 70 ? 0.72 : p.age < 12 ? 0.85 : 1);
  const ticks = wantsCar(world, p, from, dest) ? (d / 0.2) * 1.6 + 40 : (d / walk) * 1.12 + 25;
  return ticks / TICKS_PER_MIN;
}

/** Choisit un lieu ouvert parmi plusieurs types : proche, avec des amis si possible, et un peu de fantaisie. */
function pickVenue(world: World, p: Person, kinds: BKind[], from: number, minute: number, R: Rng): number {
  const { city, state } = world;
  const B = city.buildings;
  let best = -1, bestScore = 1e9;
  for (const kind of kinds) {
    for (const id of city.byKind[kind] ?? []) {
      const b = B[id]!;
      if (!isOpen(b, minute) || !isOpen(b, (minute + 40) % 1440)) continue;
      let score = tileDist(B[from]!, b) + R.range(0, 7) + ((p.look >>> (id % 13)) & 3) * 1.5;
      for (const r of p.rel) {
        if (r.aff < 0.45) continue;
        const o = state.people[r.id]!;
        if (o.loc === LOC_IN && o.at === id) score -= 6 * r.aff;
      }
      if (score < bestScore) { bestScore = score; best = id; }
    }
  }
  return best;
}

const REASONS: Partial<Record<Act, string>> = {
  sleep: 'tombe de sommeil', eatHome: 'a trop faim', eatOut: 'a trop faim', hospital: "est à l'hôpital",
};
function reasonFor(p: Person): string {
  if (p.act === 'work') return p.role === 'student' ? 'a cours' : 'tient à son travail';
  return REASONS[p.act] ?? 'a autre chose en tête';
}

function goalAct(g: Goal, p: Person): Act {
  if (g.kind === 'meet') return 'meet';
  if (g.kind === 'rumor') return 'curious';
  if (g.kind === 'goHome' || g.dest === p.home) return 'home';
  return 'visit';
}

/** Le cœur : chaque habitant choisit l'activité la plus utile pour lui, maintenant. */
export function decide(world: World, p: Person, R: Rng): void {
  const { city, state } = world;
  const t = state.tick;
  const B = city.buildings;
  if (p.act === 'hospital' && t < p.until) { p.think = p.until; return; }
  const minute = minuteOfDay(t);
  const h = minute / 60;
  const day = dayIndex(t);
  const n = p.needs;
  const here = p.loc === LOC_IN ? p.at : p.loc === LOC_WALK && p.walk ? p.walk.to : p.dest;
  const kid = p.age < 18;

  let act: Act = 'home', dest = p.home, dur = 200;
  let best = 0.2 + (h >= 20 || h < 6 ? 0.18 : 0) + (p.mood < 0.3 ? 0.15 : 0);
  const consider = (a: Act, u: number, d: number, duration: number) => {
    if (d < 0) return;
    // Inertie : on ne lâche pas ce qu'on fait (ou le trajet entamé) pour un rien.
    if (a === p.act && d === p.dest) u += p.doing ? (t < p.until ? 0.18 : 0) : 0.25;
    if (u > best) { best = u; act = a; dest = d; dur = duration; }
  };

  // Travailler (ou aller à l'école) : on calcule d'abord l'heure du départ.
  let workU = 0, workLeft = 0, alarm = false;
  if (p.work >= 0) {
    // Déjà en route : on ne fait pas demi-tour sous prétexte qu'il est trop tôt.
    const onTheWay = p.act === 'work' && !p.doing;
    const lead = onTheWay ? 240 : here === p.work ? 0 : (here === p.home && p.commute > 0 ? p.commute : travelMinutes(world, p, here, p.work)) + 10 + (p.traits.punct - 0.5) * 24;
    const sh = shiftNow(p, minute, day, lead);
    if (sh.on && p.skipDay !== sh.day) {
      workU = 1.05 + 0.55 * p.traits.punct;
      const brings = (p.look & 16) !== 0; // certains apportent leur gamelle
      if (p.role === 'worker' && !brings && minute >= 715 && minute < 815 && n.hunger > 0.38 && p.lunchDay !== day && sh.left > 90) workU = 0.3;
      workLeft = sh.left * TICKS_PER_MIN;
    } else if (!sh.on) {
      // Le réveil sonne trois quarts d'heure avant le départ.
      const soon = shiftNow(p, minute, day, lead + 45);
      alarm = soon.on && p.skipDay !== soon.day;
    }
  }

  // Dormir.
  const night = kid ? h >= 21 || h < 6.5 : h >= 22.5 || h < 6;
  const sleeping = p.act === 'sleep' && p.doing;
  let uSleep = n.fatigue * n.fatigue * n.fatigue * 1.5 + (night && n.fatigue > 0.3 ? 0.35 + 0.45 * n.fatigue : 0);
  if (sleeping && (n.fatigue > 0.05 || night)) uSleep = Math.max(uSleep + 0.45, 0.7);
  else if (n.fatigue < 0.12 && !night) uSleep = 0;
  if (alarm && !(n.fatigue > 0.75 && p.traits.punct < 0.4)) uSleep = Math.min(uSleep, 0.12);
  consider('sleep', uSleep, p.home, 900);
  if (workU > 0) consider('work', workU, p.work, workLeft);

  // Manger.
  const meal = (minute >= 390 && minute < 540) || (minute >= 705 && minute < 825) || (minute >= 1125 && minute < 1265);
  let uEat = n.hunger * n.hunger * 1.5 + (meal && n.hunger > 0.3 ? 0.32 : 0) + (n.hunger > 0.85 ? 0.4 : 0);
  const eating = p.act === 'eatHome' || p.act === 'eatOut';
  if (eating && p.doing && n.hunger > 0.03) uEat = Math.max(uEat, 0.5);
  else if (n.hunger < 0.22) uEat = 0;
  else if (sleeping) uEat *= 0.35; // on ne se relève pas pour un petit creux
  if (uEat > 0) {
    if (eating) consider(p.act, uEat, p.dest, 170);
    else if (here === p.home && (state.pantry[p.home] ?? 0) > 0) consider('eatHome', uEat, p.home, 150);
    else {
      const venue = kid ? -1 : pickVenue(world, p, ['cafe', 'restaurant'], here, minute, R);
      const dHome = tileDist(B[here]!, B[p.home]!);
      const atWork = here === p.work && p.work >= 0 && shiftNow(p, minute, day, 0).on;
      if (venue >= 0 && (atWork ? tileDist(B[here]!, B[venue]!) < 12 && (p.look & 16) === 0 : tileDist(B[here]!, B[venue]!) + 3 < dHome || (p.look & 7) < 2 || (state.pantry[p.home] ?? 0) <= 0))
        consider('eatOut', uEat, venue, 200);
      else if (atWork) consider('eatOut', uEat, p.work, 130); // gamelle ou cantine
      else consider('eatHome', uEat, p.home, 150);
    }
  }

  // Voir du monde.
  if (h >= 9 && h < 23.4) {
    const u = n.social * n.social * (0.55 + 0.6 * p.traits.soc);
    if (u > best && (p.act === 'social' || p.act === 'visit') && !p.goal && (!p.doing || t < p.until)) consider(p.act, u, p.dest, 300);
    else if (u > best) {
      let d = -1;
      let a: Act = 'social';
      if (!kid && R.chance(0.3)) {
        // Passer chez un ami qui est chez lui.
        for (const r of p.rel) {
          const o = state.people[r.id]!;
          if (r.aff > 0.55 && o.home !== p.home && o.loc === LOC_IN && o.at === o.home && o.act !== 'sleep') { d = o.home; a = 'visit'; break; }
        }
      }
      if (d < 0) d = pickVenue(world, p, kid ? ['park'] : h >= 18 ? ['bar', 'cafe', 'restaurant'] : ['cafe', 'park'], here, minute, R);
      consider(a, u, d, 280 + R.int(260));
    }
  }
  // Se détendre.
  if (h >= 8 && h < 23.6) {
    const u = n.fun * n.fun * 0.95;
    if (u > best && p.act === 'leisure' && (!p.doing || t < p.until)) consider('leisure', u, p.dest, 300);
    else if (u > best) consider('leisure', u, pickVenue(world, p, kid ? ['park'] : h < 13 ? ['park', 'cafe', 'shop'] : h < 19 ? ['park', 'cinema', 'cafe', 'shop'] : ['cinema', 'bar'], here, minute, R), 300 + R.int(240));
  }
  // Faire les courses quand le garde-manger est vide.
  if (!kid && (state.pantry[p.home] ?? 0) <= 2 && (p.act === 'shop' || !state.people.some((o) => o.home === p.home && o.act === 'shop'))) {
    const u = (state.pantry[p.home] ?? 0) <= 0 ? 0.85 : 0.5;
    if (u > best) consider('shop', u, p.act === 'shop' ? p.dest : pickVenue(world, p, ['shop'], here, minute, R), 110);
  }
  // Une rumeur à vérifier.
  if (p.rumor && t < p.rumor.until && !p.goal) {
    const u = 0.5 + 0.55 * p.traits.curio;
    if (isOpen(B[p.rumor.dest]!, minute)) consider('curious', u, p.rumor.dest, 150 + R.int(120));
  }
  // Une idée soufflée par un esprit.
  if (p.goal) {
    if (t > p.goal.until) p.goal = null;
    else consider(goalAct(p.goal, p), 0.85 + 0.75 * p.goal.w, p.goal.dest, p.goal.kind === 'meet' ? 600 : 260);
  }

  // Abandon d'une suggestion en cours de route.
  if (p.goal && !p.doing && (act !== goalAct(p.goal, p) || dest !== p.goal.dest) && p.act === goalAct(p.goal, p) && p.dest === p.goal.dest) {
    note(world, p, `Renonce à son idée : ${il(p)} ${reasonText(act, p)}.`);
    p.goal = null;
  }

  if (act === p.act && dest === p.dest) {
    if (p.doing && t >= p.until) p.until = t + dur; // on prolonge
    p.think = t + 45 + (p.id % 23);
    return;
  }
  switchTo(world, p, act, dest, dur);
}

function reasonText(act: Act, p: Person): string {
  if (act === 'work') return p.role === 'student' ? 'a cours' : 'doit travailler';
  if (act === 'sleep') return 'tombe de sommeil';
  if (act === 'eatHome' || act === 'eatOut') return 'a trop faim';
  return 'a autre chose en tête';
}

/** Point d'accroche au graphe piéton pour quelqu'un qui est déjà dans la rue. */
function walkStarts(world: World, p: Person): PedStart[] {
  const { city } = world;
  const w = p.walk;
  const B = city.buildings;
  const d1 = (x: number, y: number) => Math.abs(p.x - x) + Math.abs(p.y - y);
  const ofBuilding = (b: Building): PedStart[] => [
    { node: b.pedA, cost: d1(city.pedX[b.pedA]!, city.pedY[b.pedA]!) },
    { node: b.pedB, cost: d1(city.pedX[b.pedB]!, city.pedY[b.pedB]!) },
  ];
  if (!w) return ofBuilding(B[p.at]!);
  const next = w.nodes[w.i] ?? -1;
  const prev = w.nodes[w.i - 1] ?? -1;
  if (next < 0) return ofBuilding(B[w.to]!);
  if (prev < 0) return w.from >= 0 ? ofBuilding(B[w.from]!) : [{ node: next, cost: d1(city.pedX[next]!, city.pedY[next]!) }];
  // En pleine traversée : on finit de traverser.
  if (p.xw >= 0) return [{ node: next, cost: d1(city.pedX[next]!, city.pedY[next]!) }];
  return [
    { node: next, cost: d1(city.pedX[next]!, city.pedY[next]!) },
    { node: prev, cost: d1(city.pedX[prev]!, city.pedY[prev]!) },
  ];
}

export function switchTo(world: World, p: Person, act: Act, dest: number, dur: number): void {
  const { city, state } = world;
  const B = city.buildings;
  p.act = act;
  p.dest = dest;
  p.doing = false;
  p.until = dur; // durée prévue ; devient une échéance à l'arrivée
  p.think = state.tick + 40 + (p.id % 23);
  p.depart = act === 'work' && p.loc === LOC_IN && p.at === p.home ? state.tick : 0;
  if (p.loc === LOC_IN) {
    if (p.at === dest) return; // arrivée traitée au prochain passage
    const from = p.at;
    if (wantsCar(world, p, from, dest) && startDrive(world, p, state.cars[p.car]!, dest)) return;
    p.walk = walkBetween(city, B[from]!, B[dest]!);
    p.loc = LOC_WALK;
    p.x = B[from]!.doorX;
    p.y = B[from]!.doorY;
    p.wait = 0;
  } else if (p.loc === LOC_WALK) {
    const starts = walkStarts(world, p);
    const w = pedPath(city, starts, p.x, p.y, -1, B[dest]!);
    if (w) {
      // Si le premier nœud est celui qu'on vient de quitter en traversant, on garde le passage en cours.
      if (p.xw >= 0) w.xw[0] = p.xw;
      p.walk = w;
    }
  } else if (p.loc === LOC_CAR && p.car >= 0) {
    redirectCar(world, state.cars[p.car]!, dest);
  }
}

/** Arrivée dans le bâtiment de destination : l'activité commence. */
function arrive(world: World, p: Person, R: Rng): void {
  const { city, state } = world;
  const t = state.tick;
  const b = city.buildings[p.dest]!;
  const minute = minuteOfDay(t);
  const day = dayIndex(t);
  p.loc = LOC_IN;
  p.at = p.dest;
  p.walk = null;
  p.xw = -1;
  p.lastPass = -1;
  p.doing = true;
  p.until = t + Math.max(20, p.until);
  p.think = t + 30 + (p.id % 17);
  if (p.act !== 'home' && p.act !== 'sleep' && p.act !== 'eatHome' && p.act !== 'work' && p.act !== 'hospital' && !isOpen(b, minute) && b.id !== p.home) {
    note(world, p, `Trouve porte close ${at(b.name)}.`);
    p.until = t;
    p.think = t + 1;
    if (p.goal && p.goal.dest === b.id) p.goal = null;
    return;
  }
  switch (p.act) {
    case 'work': {
      const sh = shiftNow(p, minute, day, 240);
      if (p.depart > 0) {
        // On retient la durée réelle du trajet pour partir à l'heure la prochaine fois.
        const actual = (t - p.depart) / TICKS_PER_MIN;
        p.commute = Math.round(p.commute > 0 ? p.commute * 0.5 + actual * 0.5 : actual);
        p.depart = 0;
      }
      if (sh.on && sh.lateBy > 8 && p.lateDay !== sh.day && p.workedDay !== sh.day) {
        p.lateDay = sh.day;
        p.mood = Math.max(0, p.mood - 0.06 - 0.06 * p.traits.punct);
        state.stats.lates++;
        const acc = p.delayBy >= 0 ? state.accidents.find((a) => a.id === p.delayBy) : undefined;
        if (acc) acc.late++;
        note(world, p, `Arrive avec ${Math.round(sh.lateBy)} min de retard ${p.role === 'student' ? "à l'école" : 'au travail'}${acc ? ", à cause de l'accident" : ''}.`);
      }
      if (sh.on) p.workedDay = sh.day;
      p.delayBy = -1;
      break;
    }
    case 'shop':
      break;
    case 'curious':
      if (p.rumor) {
        const info = state.rumors.find((r) => r.id === p.rumor!.id);
        if (info) info.came++;
        note(world, p, `Va voir ${at(b.name)} ce qu'il s'y passe.`);
        if (p.goal?.kind === 'rumor') p.goal = null;
        else p.rumor.until = 0; // curiosité satisfaite
      }
      break;
    case 'meet':
      if (p.goal) p.goal.since = t;
      break;
    case 'visit':
      if (p.goal && p.goal.kind !== 'meet') {
        const o = p.goal.person >= 0 ? state.people[p.goal.person] : undefined;
        if (o && o.loc === LOC_IN && o.at === p.at) converse(world, p, o, R, true);
        else if (o) note(world, p, `Passe voir ${o.first}, sans ${o.female ? 'la' : 'le'} trouver.`);
        p.goal = null;
      }
      break;
    default:
      break;
  }
  if (p.goal && (p.goal.kind === 'goto' || p.goal.kind === 'goHome') && p.goal.dest === p.at) p.goal = null;
}

/** Deux habitants se parlent : affinités, rencontres, amours, rumeurs. */
export function converse(world: World, a: Person, b: Person, R: Rng, boosted = false): void {
  const { state, city } = world;
  const t = state.tick;
  let ra = a.rel.find((r) => r.id === b.id);
  let rb = b.rel.find((r) => r.id === a.id);
  const place = a.loc === LOC_IN ? ` ${at(city.buildings[a.at]!.name)}` : '';
  if (!ra || !rb) {
    ra = { id: b.id, kind: 'known', aff: 0.2 + (boosted ? 0.15 : 0) };
    rb = { id: a.id, kind: 'known', aff: ra.aff };
    for (const x of [a, b]) {
      // Le carnet d'adresses n'est pas infini : on oublie la connaissance la plus lointaine.
      if (x.rel.length >= 16) {
        let weak = -1;
        for (let i = 0; i < x.rel.length; i++) if (x.rel[i]!.kind === 'known' && (weak < 0 || x.rel[i]!.aff < x.rel[weak]!.aff)) weak = i;
        if (weak >= 0) {
          const gone = state.people[x.rel[weak]!.id]!;
          x.rel.splice(weak, 1);
          const back = gone.rel.findIndex((r) => r.id === x.id);
          if (back >= 0) gone.rel.splice(back, 1);
        }
      }
    }
    a.rel.push(ra);
    b.rel.push(rb);
    state.stats.meets++;
    note(world, a, `Fait la connaissance ${dePers(fullName(b))}${place}.`);
    note(world, b, `Fait la connaissance ${dePers(fullName(a))}${place}.`);
  }
  const gain = (0.03 + 0.05 * (a.traits.soc + b.traits.soc) * 0.5) * (boosted ? 2.2 : 1) * (ra.kind === 'family' || ra.kind === 'partner' ? 0.3 : 1);
  ra.aff = Math.min(1, ra.aff + gain);
  rb.aff = ra.aff;
  if ((ra.kind === 'known' || ra.kind === 'neighbor' || ra.kind === 'colleague') && ra.aff >= 0.6 && ra.kind !== 'colleague') {
    ra.kind = rb.kind = 'friend';
    note(world, a, `Se lie d'amitié avec ${fullName(b)}.`);
    note(world, b, `Se lie d'amitié avec ${fullName(a)}.`);
  }
  // Coup de foudre possible entre deux adultes libres qui s'apprécient.
  if (a.partner < 0 && b.partner < 0 && a.age >= 18 && b.age >= 18 && Math.abs(a.age - b.age) <= 12 && ra.kind !== 'family' && ra.aff >= 0.82 && a.home !== b.home && R.chance(0.12)) {
    ra.kind = rb.kind = 'partner';
    a.partner = b.id;
    b.partner = a.id;
    a.mood = Math.min(1, a.mood + 0.3);
    b.mood = Math.min(1, b.mood + 0.3);
    state.stats.couples++;
    note(world, a, `Tombe amoureu${a.female ? 'se' : 'x'} ${dePers(fullName(b))}.`);
    note(world, b, `Tombe amoureu${b.female ? 'se' : 'x'} ${dePers(fullName(a))}.`);
    chron(world, 'love', `${fullName(a)} et ${fullName(b)} sont désormais en couple${place}.`, { person: a.id });
  }
  for (const [x, y] of [[a, b], [b, a]] as [Person, Person][]) {
    x.needs.social = Math.max(0, x.needs.social - 0.22);
    x.mood = Math.min(1, x.mood + 0.03);
    x.chatWith = y.id;
    // La rumeur passe de bouche à oreille.
    if (x.rumor && t < x.rumor.until && x.rumor.hops < 5 && (!y.rumor || y.rumor.id !== x.rumor.id) && R.chance(0.4 + 0.5 * x.traits.soc)) {
      y.rumor = { id: x.rumor.id, dest: x.rumor.dest, hops: x.rumor.hops + 1, until: x.rumor.until };
      y.think = Math.min(y.think, t + 20);
      const info = state.rumors.find((r) => r.id === x.rumor!.id);
      if (info) info.heard++;
      note(world, y, `Apprend par ${x.first} qu'il se passerait quelque chose ${at(city.buildings[x.rumor.dest]!.name)}.`);
    }
  }
}

function needsTick(world: World, p: Person): void {
  const n = p.needs;
  const t = world.state.tick;
  const asleep = p.act === 'sleep' && p.doing;
  const busy = p.doing ? p.act : null;
  n.hunger += asleep ? 1 / 12000 : 1 / 2000;
  if (asleep) n.fatigue -= (0.9 + 0.2 * p.traits.energy) / 3100;
  else n.fatigue += (busy === 'work' ? 1.08 : 1) / (7000 + 1400 * p.traits.energy);
  if (!asleep) {
    n.social += (0.6 + 0.8 * p.traits.soc) / 3300;
    n.fun += (busy === 'work' ? 1.3 : 1) / 3900;
  }
  if (busy === 'eatHome' || busy === 'eatOut') {
    n.hunger -= 1 / 150;
    if (busy === 'eatOut') { n.social -= 1 / 2400; n.fun -= 1 / 3000; }
  } else if (busy === 'social' || busy === 'meet' || busy === 'visit') {
    n.social -= world.rt.occupants[p.at]!.length > 1 ? 1 / 420 : 1 / 1500;
    n.fun -= 1 / 1500;
  } else if (busy === 'leisure' || busy === 'curious') {
    n.fun -= 1 / 480;
    n.social -= 1 / 3000;
  } else if (busy === 'work') n.social -= 1 / 6000;
  else if (busy === 'home') n.fun -= 1 / 2600;
  if (t < p.chatUntil) n.social -= 1 / 250;
  n.hunger = n.hunger < 0 ? 0 : n.hunger > 1 ? 1 : n.hunger;
  n.fatigue = n.fatigue < 0 ? 0 : n.fatigue > 1 ? 1 : n.fatigue;
  n.social = n.social < 0 ? 0 : n.social > 1 ? 1 : n.social;
  n.fun = n.fun < 0 ? 0 : n.fun > 1 ? 1 : n.fun;
  const target = 0.84 - 0.45 * (n.hunger * n.hunger + n.fatigue * n.fatigue + n.social * n.social + n.fun * n.fun) * 0.25 * 2;
  p.mood += (target - p.mood) / 1500;
}

function stepWalk(world: World, p: Person, R: Rng): void {
  const { state, rt } = world;
  const t = state.tick;
  if (t < p.chatUntil) return;
  if (p.watch >= 0) {
    const acc = state.accidents.find((a) => a.id === p.watch);
    if (acc && acc.open && t < p.watchUntil) return;
    p.watch = -1;
  }
  const w = p.walk;
  if (!w || w.i * 2 >= w.pts.length) { arrive(world, p, R); return; }
  // Badauds : un accident tout près, on s'arrête regarder.
  if (state.accidents.length && p.xw < 0) {
    for (const acc of state.accidents) {
      if (!acc.open || acc.id === p.watched) continue;
      const dx = acc.x - p.x, dy = acc.y - p.y;
      if (dx * dx + dy * dy > 5) continue;
      p.watched = acc.id;
      if (p.traits.curio > 0.4 && t >= p.hurryUntil && !(p.act === 'work' && p.traits.punct > 0.7)) {
        p.watch = acc.id;
        p.watchUntil = t + 60 + Math.floor(p.traits.curio * 220);
        return;
      }
    }
  }
  // Avant un passage piéton : on regarde (sauf si on est distrait).
  const seg = w.i - 1;
  const xw = w.xw[seg] ?? -1;
  if (xw >= 0 && p.xw < 0) {
    const distracted = t < p.distractUntil;
    if (!distracted && !canCross(world, xw, p.wait)) { p.wait++; return; }
    p.xw = xw;
    rt.xwPeds[xw]!.push(p.id);
    p.wait = 0;
  }
  let speed = WALK_SPEED * (0.8 + 0.4 * p.traits.energy) * (p.age > 70 ? 0.72 : p.age < 12 ? 0.85 : 1);
  if (t < p.hurryUntil) speed *= 1.4;
  else if (p.act === 'work' && p.lateDay !== dayIndex(t)) speed *= 1.1;
  const tx = w.pts[w.i * 2]!, ty = w.pts[w.i * 2 + 1]!;
  const dx = tx - p.x, dy = ty - p.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= speed) {
    p.x = tx;
    p.y = ty;
    w.i++;
    if (p.xw >= 0) {
      const list = rt.xwPeds[p.xw]!;
      const k = list.indexOf(p.id);
      if (k >= 0) list.splice(k, 1);
      p.xw = -1;
    }
    if (w.i * 2 >= w.pts.length) arrive(world, p, R);
  } else {
    p.x += (dx / d) * speed;
    p.y += (dy / d) * speed;
  }
}

// Rencontres sur le trottoir : grille par tuile, listes chaînées (pas d'allocation).
let cellHead = new Int32Array(0);
let cellNext = new Int32Array(0);

function encounters(world: World, R: Rng): void {
  const { state, city } = world;
  const t = state.tick;
  const P = state.people;
  if (cellHead.length < city.w * city.h) cellHead = new Int32Array(city.w * city.h);
  if (cellNext.length < P.length) cellNext = new Int32Array(P.length);
  cellHead.fill(-1);
  for (const p of P) {
    if (p.loc !== LOC_WALK || p.xw >= 0 || t < p.chatUntil || p.watch >= 0) continue;
    const cell = Math.floor(p.y) * city.w + Math.floor(p.x);
    for (let q = cellHead[cell]!; q >= 0; q = cellNext[q]!) {
      const o = P[q]!;
      const dx = o.x - p.x, dy = o.y - p.y;
      if (dx * dx + dy * dy > 0.1 || p.lastPass === o.id || t < o.chatUntil) continue;
      p.lastPass = o.id;
      o.lastPass = p.id;
      if (t < p.hurryUntil || t < o.hurryUntil || p.needs.social < 0.12 || o.needs.social < 0.12) continue;
      const r = p.rel.find((x) => x.id === o.id);
      const soc = Math.min(p.traits.soc, o.traits.soc);
      const late = (p.act === 'work' && p.traits.punct > 0.5) || (o.act === 'work' && o.traits.punct > 0.5);
      const prob = (r ? 0.2 + 0.55 * soc + r.aff * 0.2 : 0.002 + 0.012 * p.traits.soc * o.traits.soc) * (late ? 0.25 : 1);
      // Qui tient une rumeur a une bonne raison d'aborder les gens.
      const carrier = p.rumor && t < p.rumor.until && !o.rumor ? p : o.rumor && t < o.rumor.until && !p.rumor ? o : null;
      if (!R.chance(carrier && !late ? Math.max(prob, 0.12 + 0.3 * carrier.traits.soc) : prob)) continue;
      const len = R.between(35, 95);
      p.chatUntil = o.chatUntil = t + len;
      converse(world, p, o, R);
      break;
    }
    cellNext[p.id] = cellHead[cell]!;
    cellHead[cell] = p.id;
  }
}

/** Conversations à l'intérieur des lieux de vie (cafés, parcs, bars...). */
function venueChat(world: World, p: Person, R: Rng): void {
  const { state, rt } = world;
  const occ = rt.occupants[p.at]!;
  if (occ.length < 2) return;
  const o = state.people[occ[R.int(occ.length)]!]!;
  if (o.id === p.id || !o.doing || o.act === 'sleep' || o.act === 'hospital') return;
  const r = p.rel.find((x) => x.id === o.id);
  if (!r && !R.chance(0.006 + 0.03 * p.traits.soc * o.traits.soc)) return;
  p.chatUntil = o.chatUntil = state.tick + R.between(30, 70);
  converse(world, p, o, R);
}

/** Au travail, à la maison, au café : celui qui sait quelque chose le répète. */
function gossip(world: World, p: Person, R: Rng): void {
  const { state, rt, city } = world;
  const t = state.tick;
  const rumor = p.rumor;
  if (!rumor || t >= rumor.until || rumor.hops >= 4) return;
  const occ = rt.occupants[p.at]!;
  if (occ.length < 2) return;
  const o = state.people[occ[R.int(occ.length)]!]!;
  if (o.id === p.id || (o.act === 'sleep' && o.doing) || o.act === 'hospital' || (o.rumor && o.rumor.id === rumor.id)) return;
  if (!R.chance(0.25 + 0.5 * p.traits.soc)) return;
  o.rumor = { id: rumor.id, dest: rumor.dest, hops: rumor.hops + 1, until: rumor.until };
  o.think = Math.min(o.think, t + 30);
  p.chatWith = o.id;
  o.chatWith = p.id;
  p.chatUntil = o.chatUntil = t + 30;
  const info = state.rumors.find((r) => r.id === rumor.id);
  if (info) info.heard++;
  note(world, o, `Apprend par ${p.first} qu'il se passerait quelque chose ${at(city.buildings[rumor.dest]!.name)}.`);
}

export function updatePeople(world: World, R: Rng): void {
  const { state, city } = world;
  const t = state.tick;
  for (const p of state.people) {
    needsTick(world, p);
    if (p.loc === LOC_IN) {
      if (!p.doing && p.at === p.dest) arrive(world, p, R);
      if (p.doing) {
        const a = p.act;
        // Fins d'activité naturelles.
        if ((a === 'eatHome' || a === 'eatOut') && p.needs.hunger <= 0.02) {
          const minute = minuteOfDay(t);
          if (minute >= 690 && minute < 870) p.lunchDay = dayIndex(t);
          if (a === 'eatHome') state.pantry[p.home] = Math.max(0, (state.pantry[p.home] ?? 0) - 1);
          p.until = t;
          p.think = t;
          p.needs.hunger = 0;
        } else if (a === 'shop' && t >= p.until) {
          state.pantry[p.home] = (state.pantry[p.home] ?? 0) + 14;
          p.act = 'leisure';
          p.until = t;
          p.think = t;
        } else if (a === 'hospital' && t >= p.until) {
          p.injured = false;
          note(world, p, "Sort de l'hôpital, sur pied.");
          chron(world, 'life', `${fullName(p)} sort de l'hôpital, remis${e(p)} de son accident.`, { person: p.id, building: p.at });
          p.act = 'home';
          p.until = t;
          p.think = t;
        } else if (a === 'meet' && p.goal?.kind === 'meet') {
          const o = state.people[p.goal.person];
          if (o && o.loc === LOC_IN && o.at === p.at && o.doing) {
            const known = p.rel.some((r) => r.id === o.id);
            converse(world, p, o, R, true);
            p.chatUntil = o.chatUntil = t + 80;
            chron(world, 'spirit', known
              ? `${fullName(p)} et ${fullName(o)} se retrouvent ${at(city.buildings[p.at]!.name)}.`
              : `${fullName(p)} et ${fullName(o)} font connaissance ${at(city.buildings[p.at]!.name)}.`,
              { person: p.id, building: p.at, by: p.goal.by });
            p.goal = null;
            if (o.goal?.kind === 'meet') o.goal = null;
            p.act = 'social';
            if (o.act === 'meet') o.act = 'social';
          } else if (p.goal.since > 0 && t - p.goal.since > 500) {
            note(world, p, `${o ? o.first : "L'autre"} n'est jamais venu${o ? e(o) : ''}. Repart déçu${e(p)}.`);
            p.mood = Math.max(0, p.mood - 0.08);
            p.goal = null;
            p.until = t;
            p.think = t;
          }
        }
        if ((a === 'social' || a === 'leisure' || a === 'eatOut' || a === 'curious' || a === 'visit') && t >= p.chatUntil && (t + p.id * 7) % 90 === 0) venueChat(world, p, R);
        if (p.rumor && a !== 'sleep' && t >= p.chatUntil && (t + p.id * 11) % 100 === 0) gossip(world, p, R);
      }
      if (t >= p.think || (p.doing && t >= p.until && p.act !== 'hospital')) decide(world, p, R);
    } else if (p.loc === LOC_WALK) {
      if (t >= p.think && p.xw < 0 && t >= p.chatUntil && p.watch < 0) decide(world, p, R);
      if (p.loc === LOC_WALK) stepWalk(world, p, R);
    } else if (p.loc === LOC_CAR) {
      if (t >= p.think) {
        p.think = t + 90;
        if (p.goal && p.dest !== p.goal.dest) decide(world, p, R);
      }
    }
  }
  encounters(world, R);
}

/**
 * Soumet une suggestion à l'habitant. C'est son IA qui tranche : on pose
 * l'objectif, on le laisse décider, et on regarde s'il l'a retenu.
 */
export function propose(world: World, p: Person, goal: Goal, R: Rng): { ok: boolean; reason: string } {
  if (p.loc !== LOC_IN && p.loc !== LOC_WALK && p.loc !== LOC_CAR) return { ok: false, reason: "n'est pas en état" };
  if (p.act === 'hospital') return { ok: false, reason: "est à l'hôpital" };
  if (p.xw >= 0) return { ok: false, reason: 'est en train de traverser' };
  const before = p.goal;
  p.goal = goal;
  decide(world, p, R);
  if (p.goal === goal && p.act === goalAct(goal, p) && p.dest === goal.dest) return { ok: true, reason: '' };
  if (p.goal === goal) p.goal = before;
  return { ok: false, reason: reasonFor(p) };
}

export { shiftNow, travelMinutes };
