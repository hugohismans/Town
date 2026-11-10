// La seule porte d'entrée du joueur dans la simulation. Chaque commande est
// validée ici (cible, paramètres, coût en influence, délai entre deux
// sollicitations) puis traduite en objectif, attention ou humeur. Jamais en
// déplacement direct : l'habitant garde la main.

import { at, chron, e, fullName, note } from './chronicle';
import { COSTS, DISTRACT_TICKS, FEEDBACK_MAX, HURRY_TICKS, INFLUENCE_MAX, INFLUENCE_REGEN_TICKS, TARGET_COOLDOWN } from './constants';
import { isOpen, propose, shiftNow } from './people';
import { tileDist } from './path';
import type { Rng } from './rng';
import { LOC_AMB, LOC_CAR, LOC_DOWN, LOC_IN, LOC_WALK, type Command, type Goal, type NeedKey, type Person, type PlayerState, type World } from './types';
import { dayIndex, minuteOfDay } from './world';

const NEEDS: NeedKey[] = ['hunger', 'fatigue', 'social', 'fun'];

export function player(world: World, id: string): PlayerState {
  return (world.state.players[id] ??= { influence: 60, sent: 0 });
}

/** Met une commande en file. Elle sera validée et appliquée au début de son tick. */
export function submit(world: World, cmd: Command): void {
  const q = world.state.queue;
  if (q.length >= 256) return;
  q.push({
    tick: Math.max(world.state.tick + 1, Math.floor(Number(cmd.tick) || 0)),
    playerId: String(cmd.playerId).slice(0, 40),
    type: cmd.type,
    targetId: Math.floor(Number(cmd.targetId)),
    params: {
      buildingId: cmd.params?.buildingId === undefined ? undefined : Math.floor(Number(cmd.params.buildingId)),
      personId: cmd.params?.personId === undefined ? undefined : Math.floor(Number(cmd.params.personId)),
      need: cmd.params?.need,
    },
  });
}

export function regenInfluence(world: World): void {
  if (world.state.tick % INFLUENCE_REGEN_TICKS !== 0) return;
  const players = world.state.players;
  for (const id of Object.keys(players).sort()) {
    const pl = players[id]!;
    if (pl.influence < INFLUENCE_MAX) pl.influence++;
  }
}

function feedback(world: World, cmd: Command, ok: boolean, text: string): void {
  const f = world.state.feedback;
  f.push({ t: world.state.tick, playerId: cmd.playerId, type: cmd.type, targetId: cmd.targetId, ok, text });
  if (f.length > FEEDBACK_MAX) f.shift();
}

function willingness(p: Person, R: Rng): number {
  const w = 0.3 + 0.6 * (1 - p.traits.stub) + (p.mood - 0.5) * 0.4 + R.range(-0.12, 0.12);
  return w < 0 ? 0 : w > 1 ? 1 : w;
}

function mkGoal(kind: Goal['kind'], dest: number, person: number, by: string, world: World, w: number): Goal {
  return { kind, dest, person, by, until: world.state.tick + 1800, w, since: 0 };
}

/** Bâtiment où se trouve (ou vers lequel se dirige) quelqu'un. */
function whereabouts(p: Person): number {
  return p.loc === LOC_IN ? p.at : p.dest;
}

function apply(world: World, cmd: Command, R: Rng): void {
  const { state, city } = world;
  const t = state.tick;
  const cost = (COSTS as Record<string, number>)[cmd.type];
  if (cost === undefined || !cmd.playerId) return;
  const pl = player(world, cmd.playerId);
  const p = state.people[cmd.targetId];
  if (!p) return feedback(world, cmd, false, 'Cet habitant est introuvable.');
  const name = p.first;
  if (pl.influence < cost) return feedback(world, cmd, false, "Pas assez d'influence.");
  if (t < p.cooldownUntil) return feedback(world, cmd, false, `${name} vient d'être sollicité${e(p)} : laissez-${p.female ? 'la' : 'le'} souffler.`);
  if (p.loc === LOC_DOWN || p.loc === LOC_AMB || p.act === 'hospital') return feedback(world, cmd, false, `${name} n'est pas en état d'écouter.`);
  const B = city.buildings;
  const bId = cmd.params.buildingId;
  const oId = cmd.params.personId;
  const other = oId !== undefined ? state.people[oId] : undefined;
  const building = bId !== undefined ? B[bId] : undefined;
  if ((cmd.type === 'goto' || cmd.type === 'rumor') && !building) return feedback(world, cmd, false, 'Ce lieu est introuvable.');
  if ((cmd.type === 'visit' || cmd.type === 'meet') && (!other || other.id === p.id)) return feedback(world, cmd, false, 'Il faut désigner un autre habitant.');
  if (cmd.type === 'whisper' && !NEEDS.includes(cmd.params.need as NeedKey)) return feedback(world, cmd, false, 'Envie inconnue.');

  pl.influence -= cost;
  pl.sent++;
  p.cooldownUntil = t + TARGET_COOLDOWN;
  const refund = () => { pl.influence = Math.min(INFLUENCE_MAX, pl.influence + (cost >> 1)); };
  const refuse = (why: string) => {
    refund();
    note(world, p, `Une idée lui traverse l'esprit, mais ${p.female ? 'elle' : 'il'} ${why}.`);
    feedback(world, cmd, false, `${name} refuse : ${p.female ? 'elle' : 'il'} ${why}.`);
  };

  switch (cmd.type) {
    case 'goto': {
      const b = building!;
      const r = propose(world, p, mkGoal('goto', b.id, -1, cmd.playerId, world, willingness(p, R)), R);
      if (!r.ok) return refuse(r.reason);
      note(world, p, `Sur un coup de tête, décide d'aller ${at(b.name)}.`);
      return feedback(world, cmd, true, `${name} se met en route vers ${b.name}.`);
    }
    case 'goHome': {
      if (p.loc === LOC_IN && p.at === p.home) return refuse('est déjà à la maison');
      const r = propose(world, p, mkGoal('goHome', p.home, -1, cmd.playerId, world, willingness(p, R)), R);
      if (!r.ok) return refuse(r.reason);
      note(world, p, 'Éprouve soudain le besoin de rentrer.');
      return feedback(world, cmd, true, `${name} décide de rentrer.`);
    }
    case 'visit': {
      const o = other!;
      const dest = o.loc === LOC_IN ? o.at : o.home;
      const known = p.rel.find((r) => r.id === o.id);
      const w = Math.min(1, willingness(p, R) + (known ? known.aff * 0.25 : -0.1));
      const r = propose(world, p, mkGoal('visit', dest, o.id, cmd.playerId, world, w), R);
      if (!r.ok) return refuse(r.reason);
      note(world, p, `A envie de passer voir ${fullName(o)}.`);
      return feedback(world, cmd, true, `${name} part voir ${o.first}.`);
    }
    case 'skipWork': {
      if (p.work < 0) return refuse("n'a ni travail ni école");
      const minute = minuteOfDay(t);
      const day = dayIndex(t);
      const sh = shiftNow(p, minute, day, 900);
      if (!sh.on) return refuse("n'a rien de prévu aujourd'hui");
      if (p.skipDay === sh.day) return refuse('a déjà pris sa journée');
      const yes = R.next() < 0.95 - 0.7 * p.traits.punct + 0.3 * p.needs.fun - 0.15 * p.traits.stub;
      if (!yes) return refuse(p.role === 'student' ? 'ne veut pas manquer les cours' : 'est trop consciencieu' + (p.female ? 'se' : 'x'));
      p.skipDay = sh.day;
      p.think = t;
      p.until = Math.min(p.until, t);
      note(world, p, p.role === 'student' ? "Décide de sécher les cours aujourd'hui." : "Décide de ne pas aller travailler aujourd'hui.");
      chron(world, 'spirit', `${fullName(p)} ${p.role === 'student' ? 'sèche les cours' : 'sèche le travail'} aujourd'hui.`, { person: p.id, by: cmd.playerId });
      return feedback(world, cmd, true, `${name} ${p.role === 'student' ? 'sèche les cours' : 'prend sa journée'}.`);
    }
    case 'distract': {
      p.distractUntil = t + DISTRACT_TICKS;
      p.distractBy = cmd.playerId;
      const text = p.loc === LOC_CAR ? `${name} quitte la route des yeux...` : p.loc === LOC_WALK ? `${name} a la tête ailleurs.` : `${name} rêvasse un instant.`;
      return feedback(world, cmd, true, text);
    }
    case 'whisper': {
      const need = cmd.params.need as NeedKey;
      p.needs[need] = Math.max(p.needs[need], need === 'fatigue' ? 0.93 : 0.9);
      p.think = t;
      const label = { hunger: 'a soudain très faim', fatigue: 'tombe de sommeil', social: 'a envie de voir du monde', fun: "a envie de s'amuser" }[need];
      note(world, p, `Sans raison, ${label}.`);
      return feedback(world, cmd, true, `${name} ${label}.`);
    }
    case 'cheer': {
      p.mood = Math.min(1, p.mood + 0.32);
      note(world, p, "Se sent soudain d'excellente humeur.");
      return feedback(world, cmd, true, `${name} retrouve le sourire.`);
    }
    case 'hurry': {
      p.hurryUntil = t + HURRY_TICKS;
      note(world, p, "Est pris" + e(p) + " d'une étrange précipitation.");
      return feedback(world, cmd, true, `${name} presse le pas.`);
    }
    case 'meet': {
      const o = other!;
      if (o.loc === LOC_DOWN || o.loc === LOC_AMB || o.act === 'hospital') return refuse(`ne peut pas voir ${o.first} pour l'instant`);
      // Un lieu ouvert, à mi-chemin.
      const minute = minuteOfDay(t);
      const ba = B[whereabouts(p)]!, bb = B[whereabouts(o)]!;
      let venue = -1, best = 1e9;
      for (const kind of ['cafe', 'park', 'bar', 'restaurant']) {
        for (const id of city.byKind[kind] ?? []) {
          const v = B[id]!;
          if (!isOpen(v, minute) || !isOpen(v, (minute + 90) % 1440)) continue;
          const d = tileDist(ba, v) + tileDist(bb, v) + (kind === 'restaurant' ? 4 : 0);
          if (d < best) { best = d; venue = id; }
        }
      }
      if (venue < 0) return refuse("ne voit aucun endroit ouvert où se retrouver");
      const known = p.rel.find((r) => r.id === o.id);
      const bonus = known ? known.aff * 0.3 : 0;
      const before = p.goal;
      const r1 = propose(world, p, mkGoal('meet', venue, o.id, cmd.playerId, world, Math.min(1, willingness(p, R) + bonus)), R);
      if (!r1.ok) return refuse(r1.reason);
      const r2 = propose(world, o, mkGoal('meet', venue, p.id, cmd.playerId, world, Math.min(1, willingness(o, R) + bonus + 0.1)), R);
      if (!r2.ok) {
        p.goal = before;
        p.think = t;
        refund();
        note(world, p, `Propose à ${o.first} de se voir, mais ${o.female ? 'elle' : 'il'} ${r2.reason}.`);
        return feedback(world, cmd, false, `${o.first} décline : ${o.female ? 'elle' : 'il'} ${r2.reason}.`);
      }
      note(world, p, `Donne rendez-vous à ${fullName(o)} ${at(B[venue]!.name)}.`);
      note(world, o, `${fullName(p)} lui donne rendez-vous ${at(B[venue]!.name)}.`);
      return feedback(world, cmd, true, `${name} et ${o.first} ont rendez-vous ${at(B[venue]!.name)}.`);
    }
    case 'rumor': {
      const b = building!;
      const id = state.nextRumor++;
      p.rumor = { id, dest: b.id, hops: 0, until: t + 2700 };
      state.rumors.push({ id, dest: b.id, by: cmd.playerId, t, heard: 1, came: 0, told: 0 });
      if (state.rumors.length > 12) state.rumors.shift();
      note(world, p, `Est persuadé${e(p)} qu'il se passe quelque chose ${at(b.name)}.`);
      propose(world, p, mkGoal('rumor', b.id, -1, cmd.playerId, world, Math.min(1, willingness(p, R) + 0.2 * p.traits.curio)), R);
      return feedback(world, cmd, true, `${name} tient un secret : il se passerait quelque chose ${at(b.name)}...`);
    }
  }
}

export function applyCommands(world: World, R: Rng): void {
  const q = world.state.queue;
  if (!q.length) return;
  const t = world.state.tick;
  const due: Command[] = [];
  const later: Command[] = [];
  for (const c of q) (c.tick <= t ? due : later).push(c);
  if (!due.length) return;
  world.state.queue = later;
  for (const c of due) apply(world, c, R);
}

/** Jalons de rumeur pour la chronique. */
export function rumorNews(world: World): void {
  const { state, city } = world;
  for (const r of state.rumors) {
    const b = city.buildings[r.dest]!;
    const stage = r.came >= 12 ? 3 : r.came >= 5 ? 2 : r.heard >= 5 ? 1 : 0;
    if (stage <= r.told) continue;
    r.told = stage;
    const text = stage === 1 ? `Une rumeur court en ville : il se passerait quelque chose ${at(b.name)}. Déjà ${r.heard} personnes au courant.`
      : stage === 2 ? `La rumeur enfle : ${r.came} curieux se pressent ${at(b.name)}.`
      : `Attroupement ${at(b.name)} : ${r.came} curieux venus vérifier une rumeur partie de rien.`;
    chron(world, 'rumor', text, { building: b.id, by: r.by });
  }
}

