// Constantes de la simulation. Tout est exprimé en ticks et en tuiles.

export const SIM_VERSION = 1;

export const TICKS_PER_SEC = 10; // en vitesse x1
export const TICKS_PER_MIN = 5; // minutes de ville
export const TICKS_PER_HOUR = 300;
export const TICKS_PER_DAY = 7200;
export const START_MINUTE = 6 * 60; // la ville démarre un lundi à 6 h

export const MAP_SIZE = 46;

// --- Géométrie d'une rue (une tuile de large) ---
export const LANE_OFF = 0.15; // centre d'une voie par rapport à l'axe
export const WALK_OFF = 0.4; // centre du trottoir par rapport à l'axe
export const XW_OUT = 0.65; // passage piéton : distance au centre du carrefour
export const STOP_BACK = 0.34; // la ligne d'arrêt est à cette distance du carrefour

// --- Voitures ---
export const CAR_LEN = 0.42;
export const MIN_GAP = 0.14;
export const ACC = 0.012;
export const BRAKE = 0.03; // freinage de confort
export const BRAKE_MAX = 0.09; // freinage d'urgence
export const SPEED_STREET = 0.2;
export const SPEED_AVENUE = 0.26;
export const SPEED_SIREN = 0.3;
export const CAR_WALK_LIMIT = 9; // au-delà (en tuiles), on prend la voiture

// --- Piétons ---
export const WALK_SPEED = 0.07;

// --- Influence ---
export const INFLUENCE_MAX = 100;
export const INFLUENCE_REGEN_TICKS = 6; // +1 toutes les 6 ticks
export const TARGET_COOLDOWN = 150; // ticks entre deux sollicitations d'un même habitant
export const DISTRACT_TICKS = 45;
export const HURRY_TICKS = 900;

export const COSTS = {
  goto: 15,
  visit: 15,
  goHome: 10,
  skipWork: 20,
  distract: 25,
  whisper: 10,
  meet: 30,
  cheer: 10,
  hurry: 15,
  rumor: 35,
} as const;

export const JOURNAL_MAX = 24;
export const CHRONICLE_MAX = 160;
export const FEEDBACK_MAX = 12;

export const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
