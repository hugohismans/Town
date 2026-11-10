// Le monde : création, pas de simulation, snapshot, restauration, hash.

import { chron } from './chronicle';
import { generateCity } from './citygen';
import { applyCommands, regenInfluence, rumorNews } from './commands';
import { DAY_NAMES, SIM_VERSION, START_MINUTE, TICKS_PER_DAY, TICKS_PER_MIN } from './constants';
import { updatePeople } from './people';
import { populate } from './popgen';
import { Rng, fnv1a } from './rng';
import { rebuildRuntime, updateTraffic } from './traffic';
import { CAR_DRIVING, LOC_IN, type City, type Runtime, type SimState, type World } from './types';

export function emptyRuntime(city: City): Runtime {
  return {
    occupants: city.buildings.map(() => []),
    edgeCars: city.edges.map(() => []),
    nodeCars: city.nodes.map(() => []),
    xwPeds: city.crosswalks.map(() => []),
    nodeBlocked: new Uint8Array(city.nodes.length),
    edgeBlocked: new Uint8Array(city.edges.length),
    sirens: [],
  };
}

export function createWorld(seed: number): World {
  const city = generateCity(seed);
  const state: SimState = {
    v: SIM_VERSION, seed, tick: 0, rng: seed ^ 0x2545f491,
    people: [], cars: [], accidents: [], pantry: city.buildings.map(() => 0), rumors: [],
    chronicle: [], players: {}, queue: [], feedback: [],
    stats: { accidents: 0, lates: 0, meets: 0, couples: 0 },
    nextEvent: 1, nextAccident: 1, nextRumor: 1, jamTick: city.lines.map(() => -99999),
  };
  const world: World = { city, state, rt: emptyRuntime(city) };
  populate(world);
  rebuildRuntime(world);
  chron(world, 'day', `Bienvenue à ${city.name}. ${state.people.length} habitants dorment encore ; le jour va se lever.`, { x: city.centerX, y: city.centerY });
  return world;
}

/** Un pas de simulation : 1/10 s en vitesse x1, soit 12 s de temps de ville. */
export function step(world: World): void {
  const s = world.state;
  s.tick++;
  const R = new Rng(s.rng);
  rebuildRuntime(world);
  applyCommands(world, R);
  regenInfluence(world);
  updatePeople(world, R);
  updateTraffic(world, R);
  dailyNews(world);
  s.rng = R.s;
}

function dailyNews(world: World): void {
  const { state, city } = world;
  const t = state.tick;
  if (t % 50 === 25) rumorNews(world);
  const tod = (START_MINUTE * TICKS_PER_MIN + t) % TICKS_PER_DAY;
  const at = (h: number, m: number) => tod === (h * 60 + m) * TICKS_PER_MIN;
  const day = DAY_NAMES[weekday(t)]!;
  const where = { x: city.centerX, y: city.centerY };
  if (at(6, 45)) chron(world, 'day', `Le jour se lève sur ${city.name}. Nous sommes ${day}.`, where);
  else if (at(8, 20) || at(17, 50)) {
    let n = 0;
    for (const c of state.cars) if (c.st === CAR_DRIVING && c.kind === 0) n++;
    if (n >= 12) chron(world, 'traffic', `Heure de pointe : ${n} voitures sur les routes.`, where);
  } else if (at(12, 30)) {
    let n = 0;
    for (const k of ['cafe', 'restaurant']) for (const b of city.byKind[k] ?? []) n += world.rt.occupants[b]!.length;
    if (n >= 10) chron(world, 'day', `Midi et demi : ${n} personnes attablées dans les cafés et restaurants.`, where);
  } else if (at(21, 15)) chron(world, 'day', `La nuit tombe. Les fenêtres s'allument une à une.`, where);
  else if (tod === 0) {
    const st = state.stats;
    const y = DAY_NAMES[(weekday(t) + 6) % 7]!;
    const parts = [
      st.accidents ? `${st.accidents} accident${st.accidents > 1 ? 's' : ''}` : 'aucun accident',
      `${st.lates} retard${st.lates > 1 ? 's' : ''}`,
      `${st.meets} nouvelle${st.meets > 1 ? 's' : ''} rencontre${st.meets > 1 ? 's' : ''}`,
    ];
    if (st.couples) parts.push(`${st.couples} nouveau${st.couples > 1 ? 'x' : ''} couple${st.couples > 1 ? 's' : ''}`);
    let asleep = 0;
    for (const p of state.people) if (p.loc === LOC_IN && p.act === 'sleep' && p.doing) asleep++;
    chron(world, 'day', `Minuit. Bilan de ${y} : ${parts.join(', ')}. ${asleep} habitants dorment déjà.`, where);
    state.stats = { accidents: 0, lates: 0, meets: 0, couples: 0 };
  }
}

// --- Horloge -----------------------------------------------------------

/** Minute de la journée (0..1439) au tick donné. */
export function minuteOfDay(tick: number): number {
  return (START_MINUTE + tick / TICKS_PER_MIN) % 1440;
}
/** Numéro du jour depuis le début (0 = premier lundi). */
export function dayIndex(tick: number): number {
  return Math.floor((START_MINUTE * TICKS_PER_MIN + tick) / TICKS_PER_DAY);
}
export function weekday(tick: number): number {
  return dayIndex(tick) % 7;
}
export function clockText(tick: number): string {
  const m = Math.floor(minuteOfDay(tick));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// --- Snapshot ------------------------------------------------------------

export function snapshot(world: World): string {
  return JSON.stringify(world.state);
}

export function restore(json: string): World {
  const state = JSON.parse(json) as SimState;
  if (state.v !== SIM_VERSION) throw new Error(`Version de sauvegarde incompatible (${state.v})`);
  const city = generateCity(state.seed);
  const world: World = { city, state, rt: emptyRuntime(city) };
  rebuildRuntime(world);
  return world;
}

export function hashState(world: World): string {
  return fnv1a(snapshot(world));
}
