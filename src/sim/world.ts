// Le monde : création, pas de simulation, snapshot, restauration, hash.

import { generateCity } from './citygen';
import { SIM_VERSION, START_MINUTE, TICKS_PER_DAY, TICKS_PER_MIN } from './constants';
import { fnv1a } from './rng';
import type { City, Runtime, SimState, World } from './types';

export function emptyRuntime(city: City): Runtime {
  return {
    occupants: city.buildings.map(() => []),
    edgeCars: city.edges.map(() => []),
    nodeCars: city.nodes.map(() => []),
    xwPeds: city.crosswalks.map(() => []),
    nodeBlocked: new Uint8Array(city.nodes.length),
    sirens: [],
  };
}

export function createWorld(seed: number): World {
  const city = generateCity(seed);
  const state: SimState = {
    v: SIM_VERSION, seed, tick: 0, rng: seed ^ 0x2545f491,
    people: [], cars: [], accidents: [], pantry: city.buildings.map(() => 0),
    chronicle: [], players: {}, queue: [], feedback: [],
    stats: { accidents: 0, lates: 0, meets: 0, couples: 0 },
    nextEvent: 1, nextAccident: 1, nextRumor: 1, jamTick: city.lines.map(() => -99999),
  };
  return { city, state, rt: emptyRuntime(city) };
}

export function step(world: World): void {
  world.state.tick++;
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
  return { city, state, rt: emptyRuntime(city) };
}

export function hashState(world: World): string {
  return fnv1a(snapshot(world));
}
