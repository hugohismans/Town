// Trafic : voitures sur les voies, carrefours (feux, priorités), accidents
// purement physiques, ambulances et dépanneuses.

import { at, chron, de, e as fem, fullName, lineName, note, sur } from './chronicle';
import { ACC, BRAKE, BRAKE_MAX, CAR_LEN, MIN_GAP, SPEED_SIREN, SPEED_STREET, TICKS_PER_MIN } from './constants';
import { buildingStarts, carRoute } from './path';
import type { Rng } from './rng';
import { CONFLICT, MOV_LEN, carPose, stopLine, type Pose } from './roadgeo';
import {
  CAR_CRASHED, CAR_DRIVING, CAR_PARKED, CAR_PULLING, CAR_REPAIR, CAR_WORKING,
  LOC_AMB, LOC_CAR, LOC_DOWN, LOC_IN, LOC_WALK,
  type Accident, type Car, type Person, type REdge, type RNode, type World,
} from './types';

// Cycle des feux : vert axe 0, orange, rouge intégral, vert axe 1, orange, rouge intégral.
const CYCLE = 170;
export const GREEN = 0, YELLOW = 1, RED = 2;
export function lightFor(node: RNode, axis: number, tick: number): number {
  const k = (tick + node.phase) % CYCLE;
  const mine = axis === 0 ? k : (k + CYCLE - 85) % CYCLE;
  return mine < 62 ? GREEN : mine < 74 ? YELLOW : RED;
}

/** Probabilité que le conducteur regarde la route à ce tick. */
function attentionOf(p: Person | undefined, tick: number): number {
  if (!p) return 1;
  if (tick < p.distractUntil) return 0.03;
  const t = p.traits;
  return 0.72 + 0.28 * t.care - Math.max(0, p.needs.fatigue - 0.7) * 1.2 - (p.mood < 0.25 ? 0.08 : 0) - (tick < p.hurryUntil ? 0.14 : 0);
}

export function rebuildRuntime(world: World): void {
  const { state, rt, city } = world;
  for (const l of rt.occupants) l.length = 0;
  for (const l of rt.edgeCars) l.length = 0;
  for (const l of rt.nodeCars) l.length = 0;
  for (const l of rt.xwPeds) l.length = 0;
  rt.sirens.length = 0;
  rt.nodeBlocked.fill(0);
  rt.edgeBlocked.fill(0);
  for (const p of state.people) {
    if (p.loc === LOC_IN) rt.occupants[p.at]!.push(p.id);
    else if (p.loc === LOC_WALK && p.xw >= 0) rt.xwPeds[p.xw]!.push(p.id);
  }
  const C = state.cars;
  for (const c of C) {
    if (c.st !== CAR_DRIVING && c.st !== CAR_CRASHED) continue;
    if (c.kind !== 0) { if (c.siren) rt.sirens.push(c.id); continue; } // les secours passent entre les files
    if (c.node >= 0) rt.nodeCars[c.node]!.push(c.id);
    else {
      rt.edgeCars[c.e]!.push(c.id);
      if (c.mv >= 0) rt.nodeCars[city.edges[c.e]!.to]!.push(c.id);
    }
  }
  for (const l of rt.edgeCars) if (l.length > 1) l.sort((a, b) => C[b]!.s - C[a]!.s || a - b);
  for (const a of state.accidents) {
    if (!a.open) continue;
    if (a.node >= 0) rt.nodeBlocked[a.node] = 1;
    if (a.edge >= 0) rt.edgeBlocked[a.edge] = 1;
  }
}

/** Un piéton peut-il s'engager sur ce passage ? */
export function canCross(world: World, xwId: number, waited: number): boolean {
  const { city, state, rt } = world;
  const xw = city.crosswalks[xwId]!;
  const node = city.nodes[xw.node]!;
  const d = xw.arm;
  const C = state.cars;
  for (const id of rt.nodeCars[node.id]!) {
    const c = C[id]!;
    if (c.st !== CAR_DRIVING) continue;
    if ((c.mv & 3) === d || (c.mv >> 2 === (d + 2) % 4 && c.node < 0)) return false;
  }
  const ie = node.inn[(d + 2) % 4]!;
  if (ie >= 0) {
    const first = rt.edgeCars[ie]![0];
    if (first !== undefined) {
      const o = C[first]!;
      if (o.st === CAR_DRIVING && o.v > 0.03 && stopLine(city, city.edges[ie]!) - o.s < o.v * 10 + 0.3) return false;
    }
  }
  const oe = node.out[d]!;
  if (oe >= 0) {
    const l = rt.edgeCars[oe]!;
    const last = l[l.length - 1];
    if (last !== undefined && C[last]!.s - CAR_LEN < 0.45 && C[last]!.v > 0.02) return false;
  }
  for (const id of rt.sirens) {
    const s = C[id]!;
    if (s.node === node.id || (city.edges[s.e]!.to === node.id && city.edges[s.e]!.len - s.s < 3) || (s.e === oe && s.s < 1)) return false;
  }
  if (node.control === 'lights' && waited < 170 && lightFor(node, d & 1, state.tick) === GREEN) return false;
  return true;
}

function setRoute(car: Car, route: number[], destS: number, destB: number): void {
  car.route = route;
  car.ri = 0;
  car.destS = destS;
  car.destB = destB;
}

/** L'habitant prend sa voiture. Renvoie false si aucun itinéraire. */
export function startDrive(world: World, p: Person, car: Car, destB: number): boolean {
  const B = world.city.buildings;
  const from = B[car.at]!;
  const to = B[destB]!;
  const r = carRoute(world, buildingStarts(from), to.edges, to.edgeS);
  if (!r) return false;
  setRoute(car, r.route, r.destS, destB);
  car.e = r.route[0]!;
  car.s = (car.e === from.edges[0] ? from.edgeS[0] : from.edgeS[1]) + CAR_LEN / 2;
  car.v = 0;
  car.node = -1;
  car.mv = -1;
  car.wait = 0;
  car.st = CAR_PULLING;
  p.loc = LOC_CAR;
  p.walk = null;
  return true;
}

/** Nouvelle destination (ou nouvel itinéraire) pour une voiture déjà en route. */
export function redirectCar(world: World, car: Car, destB: number): boolean {
  const { city } = world;
  const to = city.buildings[destB]!;
  if (car.st === CAR_PULLING) {
    const from = city.buildings[car.at]!;
    const r = carRoute(world, buildingStarts(from), to.edges, to.edgeS);
    if (!r) return false;
    setRoute(car, r.route, r.destS, destB);
    car.e = r.route[0]!;
    car.s = (car.e === from.edges[0] ? from.edgeS[0] : from.edgeS[1]) + CAR_LEN / 2;
    return true;
  }
  if (car.st !== CAR_DRIVING) return false;
  const engaged = car.node >= 0 || car.mv >= 0;
  const next = car.route[car.ri + 1];
  if (engaged && next === undefined) return false;
  const r = engaged ? carRoute(world, [[next!, 0]], to.edges, to.edgeS) : carRoute(world, [[car.e, car.s]], to.edges, to.edgeS);
  if (!r) return false;
  setRoute(car, engaged ? [car.e, ...r.route] : r.route, r.destS, destB);
  return true;
}

function isLeft(mv: number): boolean {
  return ((mv >> 2) + 3) % 4 === (mv & 3);
}

function canEnter(world: World, car: Car, node: RNode, ed: REdge, mv: number): boolean {
  const { city, state, rt } = world;
  const t = state.tick;
  const C = state.cars;
  if (rt.nodeBlocked[node.id]) return false;
  const out = car.route[car.ri + 1]!;
  const oe = city.edges[out]!;
  const xin = node.xw[(ed.dir + 2) % 4]!;
  if (xin >= 0 && rt.xwPeds[xin]!.length) return false;
  const xout = node.xw[oe.dir]!;
  if (xout >= 0 && rt.xwPeds[xout]!.length) return false;
  const ol = rt.edgeCars[out]!;
  const last = ol[ol.length - 1];
  if (last !== undefined && C[last]!.s - CAR_LEN < CAR_LEN + MIN_GAP + 0.06) return false; // on ne bloque pas le carrefour
  for (const id of rt.nodeCars[node.id]!) if (id !== car.id && CONFLICT[mv * 16 + C[id]!.mv]) return false;
  for (const id of rt.sirens) {
    const s = C[id]!;
    if (s.node === node.id || (city.edges[s.e]!.to === node.id && city.edges[s.e]!.len - s.s < 3)) return false;
  }
  if (node.control === 'none') return true;
  const axis = ed.dir & 1;
  if (node.control === 'lights' && lightFor(node, axis, t) !== GREEN) return false;
  const myRank = (node.control === 'priority' && axis === node.major ? 2 : 1) + (isLeft(mv) ? 0 : 0.5);
  for (let d = 0; d < 4; d++) {
    const ie = node.inn[d]!;
    if (ie < 0 || ie === ed.id) continue;
    const first = rt.edgeCars[ie]![0];
    if (first === undefined) continue;
    const o = C[first]!;
    if (o.mv >= 0 || o.st !== CAR_DRIVING || o.ri >= o.route.length - 1) continue;
    const omv = d * 4 + city.edges[o.route[o.ri + 1]!]!.dir;
    if (!CONFLICT[mv * 16 + omv]) continue;
    if (node.control === 'lights' && lightFor(node, d & 1, t) !== GREEN) continue;
    const od = stopLine(city, city.edges[ie]!) - o.s;
    const imminent = (o.v > 0.02 && od < o.v * 14 + 0.35) || (od < 0.45 && o.wait < 25);
    if (!imminent) continue;
    const orank = (node.control === 'priority' && (d & 1) === node.major ? 2 : 1) + (isLeft(omv) ? 0 : 0.5);
    if (orank > myRank) return false;
    if (orank === myRank && (o.wait > car.wait || (o.wait === car.wait && o.id < car.id))) return false;
  }
  return true;
}

const pose: Pose = { x: 0, y: 0, hx: 1, hy: 0 };
const pose2: Pose = { x: 0, y: 0, hx: 1, hy: 0 };

function nearestBuilding(world: World, x: number, y: number): number {
  let best = 0, bd = 1e9;
  for (const b of world.city.buildings) {
    if (b.kind === 'park') continue;
    const d = Math.abs(b.doorX - x) + Math.abs(b.doorY - y);
    if (d < bd) { bd = d; best = b.id; }
  }
  return best;
}

/** Dépose un habitant dans le bâtiment le plus proche ; il reprendra sa vie à pied. */
function setDown(world: World, p: Person, x: number, y: number): void {
  const nb = nearestBuilding(world, x, y);
  p.loc = LOC_IN;
  p.at = nb;
  p.dest = nb;
  p.act = 'leisure';
  p.doing = true;
  p.until = world.state.tick;
  p.think = world.state.tick + 5;
  p.walk = null;
  p.xw = -1;
}

function park(world: World, car: Car): void {
  const p = world.state.people[car.owner];
  car.st = CAR_PARKED;
  car.at = car.destB;
  car.v = 0;
  car.node = -1;
  car.mv = -1;
  car.wait = 0;
  car.route = [];
  if (p && p.loc === LOC_CAR) {
    p.loc = LOC_IN;
    p.at = car.destB;
    p.dest = car.destB; // au cas où la destination aurait changé entre-temps
    p.think = world.state.tick;
  }
}

function crash(world: World, a: Car, b: Car | null, ped: Person | null, impact: number, R: Rng): void {
  const { state, city } = world;
  const t = state.tick;
  const P = state.people;
  carPose(city, a, pose);
  let x = pose.x, y = pose.y;
  if (b) { carPose(city, b, pose2); x = (x + pose2.x) / 2; y = (y + pose2.y) / 2; }
  const node = a.node >= 0 ? a.node : b && b.node >= 0 ? b.node : -1;
  const ed = city.edges[a.e]!;
  const culprit = P[a.owner];
  const victim = b ? P[b.owner] : ped ?? undefined;
  const distractedPed = ped && t < ped.distractUntil + 20 && !(culprit && t - a.blind < 14);
  const who = distractedPed ? ped : culprit;
  const acc: Accident = {
    id: state.nextAccident++, tick: t, x, y, edge: node >= 0 ? -1 : a.e, node,
    line: node >= 0 ? city.nodes[node]!.lineH : ed.line,
    cars: b ? [a.id, b.id] : [a.id], peds: ped ? [ped.id] : [], injured: [],
    cause: who ? who.id : -1, by: who && t < who.distractUntil + 40 ? who.distractBy : '',
    amb: -1, tow: -1, ambDone: false, towDone: false, needTow: b !== null, open: true, reported: false, late: 0, clearedAt: 0,
  };
  for (const c of b ? [a, b] : [a]) {
    c.st = CAR_CRASHED;
    c.v = 0;
    if (c.node < 0) c.mv = -1;
    const d = P[c.owner];
    if (d && R.chance(Math.max(0.2, Math.min(0.92, 0.22 + impact * 3.2)))) { d.injured = true; acc.injured.push(d.id); }
    if (d) { d.mood = Math.max(0, d.mood - 0.25); d.shockUntil = t + 400; }
  }
  if (ped) {
    ped.injured = true;
    ped.loc = LOC_DOWN;
    ped.walk = null;
    ped.xw = -1;
    ped.chatUntil = 0;
    acc.injured.push(ped.id);
  }
  state.accidents.push(acc);
  state.stats.accidents++;
  const street = lineName(city, acc.line);
  const where = node >= 0 ? `au carrefour ${de(street)}` : sur(street);
  const blesses = acc.injured.length === 0 ? 'Plus de peur que de mal.' : acc.injured.length === 1 ? 'Un blessé.' : `${acc.injured.length} blessés.`;
  let text: string;
  if (ped && distractedPed) text = `Accident ${where} : ${fullName(ped)} traverse sans regarder et se fait renverser par ${culprit ? `la voiture de ${fullName(culprit)}` : 'une voiture'}.`;
  else if (ped) text = `Accident ${where} : ${culprit ? fullName(culprit) : 'Un conducteur'}, inattenti${culprit?.female ? 've' : 'f'}, renverse ${fullName(ped)} sur le passage piéton.`;
  else if (culprit && victim) text = `Accident ${where} : ${fullName(culprit)}, inattenti${culprit.female ? 've' : 'f'}, ${node >= 0 ? 'grille la priorité et percute' : 'percute'} la voiture de ${fullName(victim)}. ${blesses}`;
  else text = `Accident ${where}. ${blesses}`;
  chron(world, 'accident', text, { person: who ? who.id : -1, x, y, by: acc.by });
  if (culprit) note(world, culprit, ped && distractedPed ? `Renverse ${fullName(ped)}, qui traversait sans regarder.` : `Provoque un accident ${where}.`);
  if (victim && victim !== culprit) note(world, victim, ped ? `Se fait renverser ${where}.` : `Est percuté${fem(victim)} par ${culprit ? fullName(culprit) : 'une voiture'} ${where}.`);
  // Témoins : passants et conducteurs proches.
  for (const p of P) {
    if (p === culprit || p === victim) continue;
    let px = p.x, py = p.y;
    if (p.loc === LOC_CAR && p.car >= 0) { carPose(city, state.cars[p.car]!, pose2); px = pose2.x; py = pose2.y; }
    else if (p.loc !== LOC_WALK) continue;
    const dx = px - x, dy = py - y;
    if (dx * dx + dy * dy > 10) continue;
    p.mood = Math.max(0, p.mood - 0.1);
    p.shockUntil = t + 260;
    note(world, p, `Est témoin d'un accident ${where}.`);
  }
  // Ceux dont l'itinéraire passe par là seront retardés.
  for (const c of state.cars) {
    if (c.st !== CAR_DRIVING || c.kind !== 0 || c.owner < 0) continue;
    for (let i = c.ri; i < c.route.length; i++) {
      const re = city.edges[c.route[i]!]!;
      if (re.id === acc.edge || (acc.node >= 0 && re.to === acc.node)) { P[c.owner]!.delayBy = acc.id; break; }
    }
  }
}

/** Envoie un véhicule de secours vers un accident. */
function dispatch(world: World, car: Car, acc: Accident): boolean {
  const { city } = world;
  let goalE: [number, number], goalS: [number, number];
  if (acc.edge >= 0) {
    const c0 = world.state.cars[acc.cars[0]!]!;
    const s = Math.max(0.3, Math.min(city.edges[acc.edge]!.len - 0.1, (c0.e === acc.edge ? c0.s : 1) - 0.9));
    goalE = [acc.edge, acc.edge];
    goalS = [s, s];
  } else {
    const ins = city.nodes[acc.node]!.inn.filter((x) => x >= 0);
    goalE = [ins[0]!, ins[1] ?? ins[0]!];
    goalS = [city.edges[goalE[0]]!.len - 0.2, city.edges[goalE[1]]!.len - 0.2];
  }
  const from = city.buildings[car.at]!;
  const r = carRoute(world, buildingStarts(from), goalE, goalS);
  if (!r) return false;
  setRoute(car, r.route, r.destS, -1);
  car.e = r.route[0]!;
  car.s = (car.e === from.edges[0] ? from.edgeS[0] : from.edgeS[1]) + CAR_LEN / 2;
  car.v = 0;
  car.node = -1;
  car.mv = -1;
  car.st = CAR_DRIVING;
  car.siren = true;
  car.job = acc.id;
  car.until = 0;
  return true;
}

function sendHome(world: World, car: Car): void {
  const { city } = world;
  const base = city.buildings[car.kind === 1 ? city.hospital : city.garage]!;
  const engaged = car.node >= 0;
  const next = car.route[car.ri + 1];
  const r = engaged && next !== undefined ? carRoute(world, [[next, 0]], base.edges, base.edgeS) : carRoute(world, [[car.e, car.s]], base.edges, base.edgeS);
  if (!r) { car.st = CAR_PARKED; car.at = base.id; car.siren = false; car.job = -1; return; }
  setRoute(car, engaged ? [car.e, ...r.route] : r.route, r.destS, base.id);
  car.st = CAR_DRIVING;
}

/** Les secours suivent leur itinéraire sans se soucier des files (les autres leur cèdent le passage). */
function driveGhost(world: World, car: Car): void {
  const { city, state } = world;
  const t = state.tick;
  const ed = city.edges[car.e]!;
  const vmax = car.siren ? SPEED_SIREN : SPEED_STREET;
  const lastEdge = car.ri >= car.route.length - 1;
  let v = Math.min(vmax, car.v + ACC * 1.5);
  if (car.node < 0 && lastEdge) {
    const gap = car.destS - car.s;
    v = Math.min(v, Math.sqrt(2 * BRAKE * Math.max(0, gap)) + 0.01);
    if (gap < 0.08) v = 0;
  }
  car.v = v;
  car.s += v;
  if (car.node >= 0) {
    if (car.s >= MOV_LEN[car.mv]!) {
      car.s -= MOV_LEN[car.mv]!;
      car.ri++;
      car.e = car.route[car.ri]!;
      car.node = -1;
      car.mv = -1;
    }
  } else if (!lastEdge && car.s >= ed.len) {
    car.s -= ed.len;
    car.node = ed.to;
    car.mv = ed.dir * 4 + city.edges[car.route[car.ri + 1]!]!.dir;
  }
  // Arrivée.
  let arrived = car.node < 0 && lastEdge && car.destS - car.s < 0.1;
  const acc = state.accidents.find((a) => a.id === car.job);
  if (!arrived && car.destB < 0 && acc) {
    carPose(city, car, pose);
    const dx = pose.x - acc.x, dy = pose.y - acc.y;
    if (dx * dx + dy * dy < 1.1) arrived = true;
  }
  if (!arrived) return;
  car.v = 0;
  if (car.destB >= 0) {
    // Retour à la base.
    if (car.kind === 1) {
      const hosp = city.buildings[city.hospital]!;
      for (const p of state.people) {
        if (p.loc !== LOC_AMB) continue;
        p.loc = LOC_IN;
        p.at = hosp.id;
        p.dest = hosp.id;
        p.act = 'hospital';
        p.doing = true;
        p.until = t + 1500 + ((p.look >>> 3) % 3000);
        p.think = p.until;
        p.goal = null;
        note(world, p, `Est admis${fem(p)} ${at(hosp.name)}.`);
      }
    }
    car.st = CAR_PARKED;
    car.at = car.destB;
    car.siren = false;
    car.job = -1;
    car.node = -1;
    car.mv = -1;
    car.route = [];
    return;
  }
  car.st = CAR_WORKING;
  car.until = t + (car.kind === 1 ? 70 : 110);
  if (acc && acc.open) {
    const street = lineName(city, acc.line);
    chron(world, 'rescue', car.kind === 1 ? `L'ambulance arrive sur les lieux de l'accident ${de(street)}.` : `La dépanneuse arrive ${sur(street)}.`, { x: acc.x, y: acc.y });
  }
}

function closeAccident(world: World, acc: Accident, forced: boolean): void {
  const { state, city } = world;
  const t = state.tick;
  const P = state.people;
  acc.open = false;
  acc.clearedAt = t;
  for (const id of acc.cars) {
    const c = state.cars[id]!;
    if (c.st !== CAR_CRASHED) continue;
    const d = P[c.owner];
    if (acc.needTow) {
      carPose(city, c, pose);
      c.st = CAR_REPAIR;
      c.at = city.garage;
      c.until = t + 2400;
      c.node = -1;
      c.mv = -1;
      c.v = 0;
      c.route = [];
      if (d && d.loc === LOC_CAR) {
        setDown(world, d, pose.x, pose.y);
        note(world, d, 'Sa voiture part à la fourrière ; continue à pied, encore secoué' + fem(d) + '.');
      }
    } else if (d && d.loc === LOC_CAR) {
      c.st = CAR_DRIVING; // simple choc avec un piéton : il repart
      c.wait = 0;
    }
  }
  // Blessés jamais pris en charge (secours bloqués) : transportés quand même.
  const hosp = city.buildings[city.hospital]!;
  for (const id of acc.injured) {
    const p = P[id]!;
    if (p.loc === LOC_DOWN || (p.loc === LOC_CAR && p.injured)) {
      p.loc = LOC_IN;
      p.at = hosp.id;
      p.dest = hosp.id;
      p.act = 'hospital';
      p.doing = true;
      p.until = t + 1500 + ((p.look >>> 3) % 3000);
      p.think = p.until;
      p.goal = null;
      note(world, p, `Est admis${fem(p)} ${at(hosp.name)}.`);
    }
  }
  for (const id of [acc.amb, acc.tow]) {
    const c = state.cars[id];
    if (c && c.job === acc.id && c.destB < 0 && (c.st === CAR_WORKING || c.st === CAR_DRIVING)) { c.siren = c.kind === 1 && acc.injured.length > 0 && !forced; sendHome(world, c); }
  }
  const mins = Math.round((t - acc.tick) / TICKS_PER_MIN);
  chron(world, 'rescue', `${acc.needTow ? 'La dépanneuse dégage' : 'Les secours libèrent'} ${acc.node >= 0 ? 'le carrefour' : 'la voie'} ${de(lineName(city, acc.line))}. Circulation rétablie après ${mins} min.`, { x: acc.x, y: acc.y });
}

function updateAccidents(world: World): void {
  const { state, city } = world;
  const t = state.tick;
  const C = state.cars;
  for (let i = state.accidents.length - 1; i >= 0; i--) {
    const acc = state.accidents[i]!;
    if (!acc.open) {
      if (!acc.reported && t - acc.clearedAt > 700) {
        acc.reported = true;
        if (acc.late >= 2) {
          state.stats.lates += 0;
          chron(world, 'traffic', `L'accident ${de(lineName(city, acc.line))} aura mis ${acc.late} habitants en retard.`, { x: acc.x, y: acc.y, by: acc.by });
        }
      }
      if (acc.reported && t - acc.clearedAt > 3000) state.accidents.splice(i, 1);
      continue;
    }
    // Affectation des secours disponibles.
    if (acc.amb < 0 && acc.injured.length) {
      const amb = C.find((c) => c.kind === 1 && c.st === CAR_PARKED);
      if (amb && dispatch(world, amb, acc)) acc.amb = amb.id;
    }
    if (acc.tow < 0 && acc.needTow) {
      const tow = C.find((c) => c.kind === 2 && c.st === CAR_PARKED);
      if (tow && dispatch(world, tow, acc)) acc.tow = tow.id;
    }
    const amb = C[acc.amb];
    if (amb && !acc.ambDone && amb.st === CAR_WORKING && t >= amb.until) {
      acc.ambDone = true;
      const names: string[] = [];
      for (const id of acc.injured) {
        const p = state.people[id]!;
        if (p.loc === LOC_DOWN || p.loc === LOC_CAR) { p.loc = LOC_AMB; names.push(fullName(p)); }
      }
      if (names.length) chron(world, 'rescue', `${names.join(' et ')} ${names.length > 1 ? 'sont conduits' : 'part'} à l'hôpital en ambulance.`, { person: acc.injured[0], x: acc.x, y: acc.y });
      amb.siren = true;
      sendHome(world, amb);
    }
    const tow = C[acc.tow];
    if (tow && !acc.towDone && tow.st === CAR_WORKING && t >= tow.until) acc.towDone = true;
    const ambOk = acc.injured.length === 0 || acc.ambDone;
    const towOk = !acc.needTow || acc.towDone;
    if ((ambOk && towOk) || t - acc.tick > 1100) closeAccident(world, acc, !(ambOk && towOk));
  }
}

function driveCar(world: World, car: Car, lead: Car | null, R: Rng): void {
  const { city, state, rt } = world;
  const t = state.tick;
  const C = state.cars;
  const p = state.people[car.owner];
  const ed = city.edges[car.e]!;
  // Petites inattentions spontanées (téléphone, radio...).
  if (p && R.next() < 0.00005 * (1.35 - p.traits.care) && t >= p.distractUntil) { p.distractUntil = t + 22; p.distractBy = ''; }
  const att = attentionOf(p, t);
  const pObs = Math.max(0.03, Math.min(1, (att - 0.05) / 0.5));
  const observing = pObs >= 1 || R.next() < pObs;
  if (!observing) car.blind = t;
  let vmax = ed.speed * (p ? 0.9 + 0.2 * (1 - p.traits.care) : 1) * (p && t < p.hurryUntil ? 1.3 : 1);
  if (state.accidents.length) {
    // On ralentit pour regarder l'accident.
    carPose(city, car, pose);
    for (const a of state.accidents) {
      if (!a.open) continue;
      const dx = pose.x - a.x, dy = pose.y - a.y;
      if (dx * dx + dy * dy < 2.6) { vmax = Math.min(vmax, 0.075); break; }
    }
  }
  const lastEdge = car.ri >= car.route.length - 1;

  // ---- Dans le carrefour.
  if (car.node >= 0) {
    const next = car.route[car.ri + 1]!;
    const ol = rt.edgeCars[next]!;
    const last = ol[ol.length - 1];
    const gap = MOV_LEN[car.mv]! - car.s + (last !== undefined ? C[last]!.s - CAR_LEN - MIN_GAP : 99);
    let v = car.v;
    if (observing) {
      v = Math.min(car.v + ACC, vmax, Math.sqrt(2 * BRAKE * Math.max(0, gap)));
      if (v < car.v - BRAKE_MAX) v = car.v - BRAKE_MAX;
      if (v < 0.03 && gap > 0.3) v = 0.03; // on ne s'arrête pas au milieu
    }
    car.v = v;
    car.s += v;
    car.wait = v < 0.01 ? car.wait + 1 : 0;
    if (car.s >= MOV_LEN[car.mv]!) {
      car.s -= MOV_LEN[car.mv]!;
      car.ri++;
      car.e = next;
      car.node = -1;
      car.mv = -1;
    }
    return;
  }

  // ---- Sur la voie.
  const node = city.nodes[ed.to]!;
  const line = stopLine(city, ed);
  let gap = lead ? lead.s - CAR_LEN - MIN_GAP - car.s : 99;
  let entering = false;
  const mv = lastEdge ? -1 : ed.dir * 4 + city.edges[car.route[car.ri + 1]!]!.dir;
  if (lastEdge) gap = Math.min(gap, car.destS - car.s);
  else if (car.mv >= 0) {
    const ol = rt.edgeCars[car.route[car.ri + 1]!]!;
    const last = ol[ol.length - 1];
    gap = Math.min(gap, ed.len - car.s + MOV_LEN[mv]! + (last !== undefined ? C[last]!.s - CAR_LEN - MIN_GAP : 99));
  } else if (!lead || lead.mv >= 0) {
    const dLine = line - car.s;
    if (dLine < (car.v * car.v) / (2 * BRAKE) + 2 * car.v + 0.35) {
      if (observing) {
        entering = canEnter(world, car, node, ed, mv);
        if (!entering) gap = Math.min(gap, dLine);
      } else entering = true;
    }
  } else if (lead) {
    gap = Math.min(gap, line - car.s + 99);
  }
  let v = car.v;
  if (observing) {
    v = Math.min(car.v + ACC, vmax, Math.sqrt(2 * BRAKE * Math.max(0, gap)));
    if (v < car.v - BRAKE_MAX) v = car.v - BRAKE_MAX;
    if (v < 0) v = 0;
  }
  let s = car.s + v;
  if (lead && s > lead.s - CAR_LEN - 0.02) {
    const impact = v - lead.v;
    s = Math.max(car.s, lead.s - CAR_LEN - 0.02);
    if (!observing && impact > 0.035 && lead.kind === 0) {
      car.s = s;
      crash(world, car, lead, null, impact, R);
      return;
    }
    v = Math.min(v, lead.v);
  }
  // Franchissement de la ligne d'arrêt : on s'engage.
  if (!lastEdge && car.mv < 0 && s > line) {
    if (observing && !entering && car.v - BRAKE_MAX <= 0.001) {
      s = Math.max(car.s, line); // on s'arrête à la ligne
      v = 0;
    } else {
      car.mv = mv;
      rt.nodeCars[node.id]!.push(car.id);
      if (!observing && p && node.control === 'lights' && lightFor(node, ed.dir & 1, t) === RED) {
        chron(world, 'traffic', `${fullName(p)} grille le feu rouge au carrefour ${de(lineName(city, node.lineH))}.`, { person: p.id, x: node.x + 0.5, y: node.y + 0.5, by: t < p.distractUntil ? p.distractBy : '' });
        note(world, p, 'Grille un feu rouge sans même le voir.');
      }
    }
  }
  car.v = v;
  car.s = s;
  car.wait = v < 0.01 ? car.wait + 1 : 0;

  // Piétons sur le passage.
  if (v > 0.04) {
    const xw = car.mv >= 0 && s > line ? node.xw[(ed.dir + 2) % 4]! : s < 0.34 + CAR_LEN ? city.nodes[ed.from]!.xw[ed.dir]! : -1;
    if (xw >= 0 && rt.xwPeds[xw]!.length) {
      carPose(city, car, pose);
      for (const pid of rt.xwPeds[xw]!) {
        const q = state.people[pid]!;
        const dx = q.x - pose.x - pose.hx * 0.12, dy = q.y - pose.y - pose.hy * 0.12;
        if (dx * dx + dy * dy < 0.035 && (t - car.blind < 12 || t < q.distractUntil + 20)) {
          crash(world, car, null, q, v, R);
          return;
        }
      }
    }
  }

  if (lastEdge) {
    // Destination dépassée par inattention : on refait le tour.
    if (s > car.destS + 0.3) {
      if (!redirectCar(world, car, car.destB)) car.destS = ed.len - 0.5;
    } else if (car.destS - s < 0.09 || (car.destS - s < 1.3 && car.wait > 25)) {
      park(world, car);
      return;
    }
  } else if (s >= ed.len) {
    car.s = s - ed.len;
    car.node = node.id;
    if (car.mv < 0) car.mv = mv;
    return;
  }

  // Coincé : on cherche un autre chemin, et à bout de patience on abandonne la voiture.
  if (car.wait > 0 && car.mv < 0 && p) {
    if ((car.wait === 50 || car.wait % 170 === 169) && car.destB >= 0) redirectCar(world, car, car.destB);
    if (car.wait > 1100) {
      carPose(city, car, pose);
      const nb = nearestBuilding(world, pose.x, pose.y);
      car.st = CAR_PARKED;
      car.at = nb;
      car.v = 0;
      car.wait = 0;
      car.route = [];
      setDown(world, p, pose.x, pose.y);
      note(world, p, 'Excédé' + fem(p) + ' par le bouchon, abandonne sa voiture et continue à pied.');
      chron(world, 'traffic', `${fullName(p)}, excédé${fem(p)} par le bouchon ${sur(lineName(city, ed.line))}, abandonne sa voiture et finit à pied.`, { person: p.id, x: pose.x, y: pose.y });
    }
  }
}

export function updateTraffic(world: World, R: Rng): void {
  const { state, city, rt } = world;
  const t = state.tick;
  const C = state.cars;

  // Sorties de stationnement, réparations, secours.
  for (const car of C) {
    if (car.st === CAR_PULLING) {
      const l = rt.edgeCars[car.e]!;
      let free = true;
      for (const id of l) {
        const o = C[id]!;
        if (o.s > car.s - CAR_LEN - 0.25 - o.v * 9 && o.s - CAR_LEN < car.s + 0.2) { free = false; break; }
      }
      const p = state.people[car.owner];
      if (free) {
        car.st = CAR_DRIVING;
        car.wait = 0;
        l.push(car.id);
        l.sort((a, b) => C[b]!.s - C[a]!.s || a - b);
      } else if (++car.wait > 400 && p) {
        // Impossible de sortir : il y va à pied.
        car.st = CAR_PARKED;
        car.wait = 0;
        p.loc = LOC_IN;
        p.think = t;
        p.doing = false;
        p.dest = p.at;
        p.act = 'home';
      }
    } else if (car.st === CAR_PARKED && car.owner >= 0 && t % 600 === car.id % 600) {
      // Voiture oubliée loin de chez soi : son propriétaire finit par aller la rechercher.
      const p = state.people[car.owner]!;
      if (car.at !== p.home && p.loc === LOC_IN && p.at === p.home && p.act === 'sleep') car.at = p.home;
    } else if (car.st === CAR_REPAIR && t >= car.until) {
      const p = state.people[car.owner];
      car.st = CAR_PARKED;
      car.at = p ? p.home : city.garage;
      if (p) note(world, p, 'Récupère sa voiture, réparée.');
    }
  }

  // Voitures dans les carrefours d'abord, puis voie par voie, de l'avant vers l'arrière.
  for (const car of C) if (car.st === CAR_DRIVING && car.kind === 0 && car.node >= 0) driveCar(world, car, null, R);
  for (let e = 0; e < rt.edgeCars.length; e++) {
    const l = rt.edgeCars[e]!;
    for (let k = 0; k < l.length; k++) {
      const car = C[l[k]!]!;
      if (car.st !== CAR_DRIVING || car.node >= 0 || car.e !== e) continue;
      driveCar(world, car, k > 0 ? C[l[k - 1]!]! : null, R);
    }
  }
  for (const car of C) if (car.kind !== 0 && car.st === CAR_DRIVING) driveGhost(world, car);

  // Collisions dans les carrefours : seulement si quelqu'un ne regardait pas.
  for (const n of city.nodes) {
    const l = rt.nodeCars[n.id]!;
    if (l.length < 2) continue;
    for (let i = 0; i < l.length; i++)
      for (let j = i + 1; j < l.length; j++) {
        const a = C[l[i]!]!, b = C[l[j]!]!;
        if (a.mv < 0 || b.mv < 0 || (a.st !== CAR_DRIVING && b.st !== CAR_DRIVING) || a.st === CAR_PARKED || b.st === CAR_PARKED) continue;
        if (!CONFLICT[a.mv * 16 + b.mv] || a.mv >> 2 === b.mv >> 2) continue;
        const ba = t - a.blind < 14 && a.st === CAR_DRIVING, bb = t - b.blind < 14 && b.st === CAR_DRIVING;
        if (!ba && !bb) continue;
        carPose(city, a, pose);
        carPose(city, b, pose2);
        const dx = pose.x - pose2.x, dy = pose.y - pose2.y;
        if (dx * dx + dy * dy > 0.1) continue;
        const [x, y] = ba ? [a, b] : [b, a];
        crash(world, x, y, null, Math.max(a.v, b.v), R);
      }
  }

  updateAccidents(world);

  // Bouchons : assez de véhicules à l'arrêt sur la même rue.
  if (t % 100 === 50) {
    const count = new Int32Array(city.lines.length);
    const firstCar = new Int32Array(city.lines.length).fill(-1);
    for (const car of C) {
      if (car.st !== CAR_DRIVING || car.kind !== 0 || car.wait < 45) continue;
      const line = city.edges[car.e]!.line;
      count[line]!++;
      if (firstCar[line]! < 0) firstCar[line] = car.id;
    }
    for (let li = 0; li < count.length; li++) {
      if (count[li]! < 6 || t - (state.jamTick[li] ?? -99999) < 1500) continue;
      state.jamTick[li] = t;
      carPose(city, C[firstCar[li]!]!, pose);
      chron(world, 'traffic', `Bouchon ${sur(lineName(city, li))} : ${count[li]} véhicules à l'arrêt.`, { x: pose.x, y: pose.y });
    }
  }
}
