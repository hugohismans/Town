// Modèle de données. City = statique (fonction de la graine). SimState =
// dynamique, uniquement des objets, tableaux, nombres, chaînes et booléens :
// JSON.stringify(state) est le snapshot.

import type { COSTS } from './constants';

// Directions : 0 = est (+x), 1 = sud (+y), 2 = ouest, 3 = nord.
export type Dir = 0 | 1 | 2 | 3;
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export const T_GRASS = 0;
export const T_ROAD = 1;
export const T_LOT = 2;
export const T_PARK = 3;
export const T_WATER = 4;
export const T_GARDEN = 5;
export const T_FIELD = 6;
export const T_BRIDGE = 7;

export type BKind =
  | 'house'
  | 'apartment'
  | 'office'
  | 'shop'
  | 'cafe'
  | 'restaurant'
  | 'bar'
  | 'hospital'
  | 'school'
  | 'park'
  | 'garage'
  | 'townhall'
  | 'cinema';

export interface RoadLine {
  id: number;
  axis: 0 | 1; // 0 = horizontale (le long de x), 1 = verticale
  pos: number; // y si horizontale, x si verticale
  kind: 'avenue' | 'boulevard' | 'quay' | 'street';
  name: string;
}

export type Control = 'lights' | 'priority' | 'none';

export interface RNode {
  id: number;
  x: number; // tuile
  y: number;
  out: number[]; // out[dir] = arête sortante vers dir, ou -1
  inn: number[]; // inn[dir] = arête entrante qui roule vers dir (donc venant du côté opposé), ou -1
  deg: number;
  control: Control;
  major: 0 | 1; // axe prioritaire (0 = est-ouest, 1 = nord-sud)
  phase: number; // décalage du cycle de feux
  xw: number[]; // xw[dir] = passage piéton sur la branche dir, ou -1
  lineH: number;
  lineV: number;
}

export interface REdge {
  id: number;
  from: number;
  to: number;
  dir: Dir;
  len: number; // longueur roulable (hors tuiles de carrefour)
  x0: number; // début de la voie (centre de voie)
  y0: number;
  line: number;
  speed: number;
  rev: number; // arête de sens opposé
  bridge: boolean;
}

export interface PedLink {
  to: number;
  len: number;
  xw: number; // passage piéton emprunté, ou -1
}

export interface Crosswalk {
  id: number;
  node: number;
  arm: Dir;
  x: number; // milieu
  y: number;
}

export interface Building {
  id: number;
  kind: BKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floors: number;
  variant: number; // uint32 : couleurs, style
  district: 0 | 1 | 2; // 0 centre, 1 mixte, 2 résidentiel
  doorDir: Dir; // du bâtiment vers la rue
  ax: number; // tuile de rue desservie
  ay: number;
  doorX: number; // point sur le trottoir, devant la porte
  doorY: number;
  pedA: number; // extrémités du tronçon de trottoir
  pedB: number;
  pedDa: number; // distance porte -> pedA
  pedLen: number;
  edges: [number, number]; // les deux voies du tronçon
  edgeS: [number, number]; // abscisse de l'accès sur chacune
  line: number;
  jobs: number;
  units: number; // logements
  openFrom: number; // minutes ; 0 et 1440 = toujours ouvert
  openTo: number;
}

export interface Deco {
  x: number;
  y: number;
  kind: number;
  size: number;
}

export interface City {
  seed: number;
  name: string;
  w: number;
  h: number;
  tiles: Uint8Array;
  lot: Int16Array; // id de bâtiment par tuile, -1 sinon
  lines: RoadLine[];
  nodes: RNode[];
  nodeAt: Int16Array; // id de nœud par tuile, -1 sinon
  edges: REdge[];
  /** Pour chaque tuile de rue hors carrefour : arête dans le sens croissant, ou -1. */
  edgeAt: Int16Array;
  pedX: number[];
  pedY: number[];
  pedAdj: PedLink[][];
  crosswalks: Crosswalk[];
  buildings: Building[];
  byKind: Record<string, number[]>;
  trees: Deco[];
  lamps: Deco[];
  canalX: number; // première colonne d'eau
  canalW: number;
  centerX: number;
  centerY: number;
  hospital: number;
  garage: number;
}

// ---------------------------------------------------------------- dynamique

export type NeedKey = 'hunger' | 'fatigue' | 'social' | 'fun';

export interface Traits {
  soc: number; // sociable
  punct: number; // ponctuel
  care: number; // prudent, attentif
  stub: number; // têtu : résiste aux suggestions
  energy: number; // énergique : marche vite, dort moins
  curio: number; // curieux : badaud, sensible aux rumeurs
}

export type RelKind = 'family' | 'partner' | 'friend' | 'colleague' | 'neighbor' | 'known';

export interface Rel {
  id: number;
  kind: RelKind;
  aff: number; // 0..1
}

export type Act =
  | 'sleep'
  | 'home'
  | 'eatHome'
  | 'work'
  | 'eatOut'
  | 'shop'
  | 'social'
  | 'leisure'
  | 'visit'
  | 'meet'
  | 'curious'
  | 'hospital';

// Où est l'habitant.
export const LOC_IN = 0; // dans un bâtiment (p.at)
export const LOC_WALK = 1;
export const LOC_CAR = 2;
export const LOC_DOWN = 3; // blessé, au sol
export const LOC_AMB = 4; // dans l'ambulance

export interface Walk {
  pts: number[]; // x0,y0,x1,y1,...
  nodes: number[]; // nœud piéton de chaque point, -1 pour une porte
  xw: number[]; // xw[i] = passage emprunté entre le point i et i+1, ou -1
  i: number; // prochain point visé
  from: number; // bâtiment de départ (-1 si parti de la rue)
  to: number; // bâtiment d'arrivée
}

export interface Goal {
  kind: 'goto' | 'visit' | 'goHome' | 'meet' | 'rumor';
  dest: number; // bâtiment
  person: number; // -1 si aucun
  by: string; // joueur à l'origine, '' si spontané
  until: number; // tick d'expiration
  w: number; // bonne volonté 0..1 : poids de la suggestion dans la décision
  since: number; // tick d'arrivée sur place (attente d'un rendez-vous), 0 sinon
}

export interface Rumor {
  id: number;
  dest: number;
  hops: number;
  until: number;
}

export interface RumorInfo {
  id: number;
  dest: number;
  by: string;
  t: number;
  heard: number; // habitants au courant
  came: number; // curieux arrivés sur place
  told: number; // dernier palier annoncé dans la chronique
}

export interface JournalEntry {
  t: number;
  s: string;
}

export interface Person {
  id: number;
  first: string;
  last: string;
  female: boolean;
  age: number;
  home: number;
  work: number; // bâtiment (école pour les élèves), -1 sinon
  role: 'worker' | 'student' | 'retired' | 'idle';
  job: string;
  shiftStart: number; // minutes
  shiftEnd: number; // peut dépasser 1440 (équipe de nuit)
  daysOff: number; // masque de bits des jours de repos
  commute: number; // durée habituelle du trajet domicile-travail (minutes), apprise à l'usage
  depart: number; // tick de départ du trajet en cours vers le travail, 0 sinon
  traits: Traits;
  needs: Record<NeedKey, number>;
  mood: number; // 0..1
  rel: Rel[];
  partner: number;
  car: number;
  look: number; // uint32 : apparence

  loc: number;
  at: number; // bâtiment courant (ou dernier quitté)
  x: number;
  y: number;
  walk: Walk | null;
  act: Act;
  dest: number; // bâtiment de l'activité
  doing: boolean; // sur place, en train de faire l'activité
  until: number; // fin prévue de l'activité
  think: number; // prochain tick de décision
  goal: Goal | null;
  rumor: Rumor | null;

  wait: number; // ticks d'attente (passage piéton)
  xw: number; // passage en cours de traversée, -1 sinon
  chatWith: number;
  chatUntil: number;
  lastPass: number; // dernier habitant croisé (évite de retirer au sort à chaque tick)
  watch: number; // accident regardé (badaud), -1 sinon
  watched: number; // dernier accident regardé
  watchUntil: number;

  distractUntil: number;
  distractBy: string; // joueur à l'origine de la distraction, '' sinon
  hurryUntil: number;
  shockUntil: number;
  cooldownUntil: number; // garde-fou : pas de nouvelle sollicitation avant ce tick
  skipDay: number; // jour où il sèche le travail, -1 sinon
  lunchDay: number; // jour où le déjeuner est pris
  lateDay: number; // jour où un retard a été noté
  workedDay: number;
  delayBy: number; // accident qui l'a retardé, -1 sinon
  injured: boolean;
  journal: JournalEntry[];
}

export const CAR_PARKED = 0;
export const CAR_PULLING = 1; // attend un créneau pour sortir du stationnement
export const CAR_DRIVING = 2;
export const CAR_CRASHED = 3;
export const CAR_REPAIR = 4;
export const CAR_WORKING = 5; // véhicule de secours à l'arrêt sur les lieux

export interface Car {
  id: number;
  owner: number; // -1 pour un véhicule de service
  kind: 0 | 1 | 2; // 0 voiture, 1 ambulance, 2 dépanneuse
  color: number;
  st: number;
  at: number; // bâtiment de stationnement
  e: number; // arête courante
  s: number; // abscisse du pare-chocs avant ; dans un carrefour, distance parcourue
  v: number;
  node: number; // carrefour en cours de traversée, -1 sinon
  mv: number; // mouvement engagé (dirIn * 4 + dirOut), -1 sinon
  route: number[];
  ri: number;
  destB: number;
  destS: number;
  wait: number; // ticks à l'arrêt
  blind: number; // dernier tick où le conducteur n'a pas regardé la route
  siren: boolean;
  job: number; // accident traité (secours), -1 sinon
  until: number; // fin de l'intervention / de la réparation
}

export interface Accident {
  id: number;
  tick: number;
  x: number;
  y: number;
  edge: number; // arête touchée, -1 si dans un carrefour
  node: number; // carrefour bloqué, -1 sinon
  line: number;
  cars: number[];
  peds: number[];
  injured: number[];
  cause: number; // habitant inattentif
  by: string; // joueur ayant provoqué la distraction, '' sinon
  amb: number; // ambulance affectée, -1
  tow: number;
  ambDone: boolean;
  towDone: boolean;
  needTow: boolean;
  open: boolean;
  reported: boolean; // bilan des retards publié
  late: number; // habitants retardés
  clearedAt: number;
}

export interface ChronicleEvent {
  id: number;
  t: number;
  kind: 'accident' | 'rescue' | 'traffic' | 'social' | 'love' | 'rumor' | 'life' | 'day' | 'spirit';
  text: string;
  person: number; // -1 si aucun
  building: number;
  x: number; // lieu (tuiles), -1 si aucun
  y: number;
  by: string; // joueur à l'origine
}

export type CommandType = keyof typeof COSTS;

export interface Command {
  tick: number;
  playerId: string;
  type: CommandType;
  targetId: number;
  params: { buildingId?: number; personId?: number; need?: NeedKey };
}

export interface Feedback {
  t: number;
  playerId: string;
  type: string;
  targetId: number;
  ok: boolean;
  text: string;
}

export interface PlayerState {
  influence: number;
  sent: number;
}

export interface DayStats {
  accidents: number;
  lates: number;
  meets: number;
  couples: number;
}

export interface SimState {
  v: number;
  seed: number;
  tick: number;
  rng: number;
  people: Person[];
  cars: Car[];
  accidents: Accident[];
  pantry: number[]; // par bâtiment (seuls les logements s'en servent)
  rumors: RumorInfo[];
  chronicle: ChronicleEvent[];
  players: Record<string, PlayerState>;
  queue: Command[];
  feedback: Feedback[];
  stats: DayStats;
  nextEvent: number;
  nextAccident: number;
  nextRumor: number;
  jamTick: number[]; // par ligne de rue : dernier tick où un bouchon a été signalé
}

/** Index dérivés, reconstruits à chaque tick. Jamais sérialisés. */
export interface Runtime {
  occupants: number[][]; // habitants par bâtiment
  edgeCars: number[][]; // voitures par arête, de l'avant vers l'arrière
  nodeCars: number[][]; // voitures engagées dans chaque carrefour
  xwPeds: number[][]; // piétons en train de traverser, par passage
  nodeBlocked: Uint8Array; // carrefour occupé par un accident
  edgeBlocked: Uint8Array; // voie occupée par un accident
  sirens: number[]; // véhicules en intervention
}

export interface World {
  city: City;
  state: SimState;
  rt: Runtime;
}
