// Lectures pratiques de l'état, partagées par le rendu et l'interface.

import { at } from './chronicle';
import { carPose, type Pose } from './roadgeo';
import { CAR_DRIVING, CAR_WORKING, LOC_AMB, LOC_CAR, LOC_DOWN, LOC_IN, LOC_WALK, type Act, type Person, type World } from './types';
import { dayIndex } from './world';

const tmp: Pose = { x: 0, y: 0, hx: 1, hy: 0 };

/** Position d'un habitant dans le monde. Renvoie false s'il est à l'intérieur (out = porte du bâtiment). */
export function personPos(world: World, p: Person, out: { x: number; y: number }): boolean {
  if (p.loc === LOC_WALK || p.loc === LOC_DOWN) { out.x = p.x; out.y = p.y; return true; }
  if (p.loc === LOC_CAR && p.car >= 0) {
    carPose(world.city, world.state.cars[p.car]!, tmp);
    out.x = tmp.x; out.y = tmp.y;
    return true;
  }
  if (p.loc === LOC_AMB) {
    const amb = world.state.cars.find((c) => c.kind === 1 && (c.st === CAR_DRIVING || c.st === CAR_WORKING));
    if (amb) { carPose(world.city, amb, tmp); out.x = tmp.x; out.y = tmp.y; return true; }
  }
  const b = world.city.buildings[p.at]!;
  out.x = b.x + b.w / 2; out.y = b.y + b.h / 2;
  return false;
}

const GOING: Record<Act, string> = {
  sleep: 'rentre se coucher', home: 'rentre à la maison', eatHome: 'rentre manger', work: 'va au travail',
  eatOut: 'va manger', shop: 'va faire des courses', social: 'va retrouver du monde', leisure: 'va se détendre',
  visit: 'va rendre visite', meet: 'se rend à un rendez-vous', curious: 'va vérifier une rumeur', hospital: "est à l'hôpital",
};
const DOING: Record<Act, string> = {
  sleep: 'dort', home: 'se repose à la maison', eatHome: 'mange à la maison', work: 'travaille',
  eatOut: 'mange', shop: 'fait des courses', social: 'discute', leisure: 'se détend',
  visit: 'est en visite', meet: 'attend son rendez-vous', curious: 'cherche ce qui se passe', hospital: "est soigné à l'hôpital",
};

/** Ce que fait l'habitant, en une phrase. */
export function activityText(world: World, p: Person): string {
  const t = world.state.tick;
  const B = world.city.buildings;
  if (p.loc === LOC_DOWN) return 'est blessé, au sol';
  if (p.loc === LOC_AMB) return "est transporté à l'hôpital";
  if (p.loc === LOC_CAR && p.car >= 0 && world.state.cars[p.car]!.st !== CAR_DRIVING && world.state.cars[p.car]!.st !== 1) return 'est immobilisé après un accident';
  const dest = B[p.dest]!;
  if (p.doing && p.loc === LOC_IN) {
    if (t < p.chatUntil && p.chatWith >= 0) return `discute avec ${world.state.people[p.chatWith]!.first} ${at(dest.name)}`;
    if (p.act === 'work') return `${p.role === 'student' ? 'est en classe' : 'travaille'} ${at(dest.name)}`;
    if (p.act === 'sleep' || p.act === 'home' || p.act === 'eatHome') return DOING[p.act];
    return `${DOING[p.act]} ${at(dest.name)}`;
  }
  if (p.loc === LOC_WALK && t < p.chatUntil && p.chatWith >= 0) return `bavarde avec ${world.state.people[p.chatWith]!.first} sur le trottoir`;
  if (p.loc === LOC_WALK && p.watch >= 0) return "regarde l'accident";
  const how = p.loc === LOC_CAR ? 'en voiture' : 'à pied';
  let what = GOING[p.act];
  if (p.act === 'work' && p.role === 'student') what = "va à l'école";
  if (p.act === 'visit' || p.act === 'curious' || p.act === 'eatOut' || p.act === 'shop' || p.act === 'social' || p.act === 'leisure' || p.act === 'meet' || p.act === 'work')
    what += ` ${at(dest.name)}`;
  return `${what}, ${how}`;
}

/** Petite icône de pensée à afficher au-dessus de la tête. */
export function thoughtIcon(world: World, p: Person): string {
  const t = world.state.tick;
  if (p.loc === LOC_DOWN) return '🤕';
  if (t < p.distractUntil) return '💫';
  if (t < p.shockUntil && p.loc !== LOC_IN) return '😱';
  if (t < p.chatUntil) return p.partner === p.chatWith && p.chatWith >= 0 ? '❤️' : '💬';
  if (p.watch >= 0) return '👀';
  if (p.loc === LOC_WALK && p.wait > 12) return '✋';
  if (t < p.hurryUntil) return '⚡';
  if (p.rumor && t < p.rumor.until && p.act === 'curious') return '🤫';
  if (p.needs.hunger > 0.82) return '🍽️';
  if (p.needs.fatigue > 0.88) return '😴';
  switch (p.act) {
    case 'work': return p.lateDay === dayIndex(t) ? '😰' : p.role === 'student' ? '🎒' : '💼';
    case 'eatOut': case 'eatHome': return '🍴';
    case 'shop': return '🛍️';
    case 'social': case 'visit': return '👋';
    case 'meet': return '💐';
    case 'leisure': return '🎈';
    case 'sleep': return '🌙';
    case 'curious': return '🤔';
    case 'home': return '🏠';
    default: return '';
  }
}

export function moodIcon(p: Person): string {
  return p.mood > 0.8 ? '😄' : p.mood > 0.62 ? '🙂' : p.mood > 0.45 ? '😐' : p.mood > 0.28 ? '😕' : '😞';
}
