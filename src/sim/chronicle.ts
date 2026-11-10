// La chronique de la ville et le journal de chaque habitant, en français.

import { CHRONICLE_MAX, JOURNAL_MAX } from './constants';
import type { ChronicleEvent, City, Person, World } from './types';

export function fullName(p: Person): string {
  return `${p.first} ${p.last}`;
}
/** Accord au féminin : e(p) vaut 'e' pour une femme. */
export function e(p: Person): string {
  return p.female ? 'e' : '';
}
export function il(p: Person): string {
  return p.female ? 'elle' : 'il';
}
export function lineName(city: City, line: number): string {
  return city.lines[line]?.name ?? 'la rue';
}
/** « rue des Lilas » -> « de la rue des Lilas », « avenue X » -> « de l'avenue X ». */
export function de(name: string): string {
  return /^[aeiouéèh]/i.test(name) ? `de l'${name}` : name.startsWith('boulevard') || name.startsWith('quai') ? `du ${name}` : `de la ${name}`;
}
/** « de Paul », « d'Inès ». */
export function dePers(name: string): string {
  return /^[AEIOUÉÈÎYH]/i.test(name) ? `d'${name}` : `de ${name}`;
}
export function sur(name: string): string {
  return name.startsWith('rue') ? name : /^[aeiouéèh]/i.test(name) ? `sur l'${name}` : name.startsWith('boulevard') || name.startsWith('quai') ? `sur le ${name}` : name;
}
/** « au café », « à l'hôpital », « à la mairie », « chez Lucie ». */
export function at(name: string): string {
  if (/^(Chez|Aux|Au|À) /.test(name)) return name.replace(/^Chez/, 'chez').replace(/^Aux/, 'aux').replace(/^Au /, 'au ');
  if (/^(Le|La|L'|Les) /.test(name) || name.startsWith("L'")) {
    if (name.startsWith('Le ')) return `au ${name.slice(3)}`;
    if (name.startsWith('Les ')) return `aux ${name.slice(4)}`;
    return `à ${name.charAt(0).toLowerCase()}${name.slice(1)}`;
  }
  if (/^\d/.test(name)) return `au ${name}`;
  const fem = /^(Boulangerie|Épicerie|Librairie|Pharmacie|Fromagerie|Quincaillerie|Boucherie|Mercerie|Cordonnerie|Papeterie|Mairie|Résidence|Banque|Maison|Agence|Imprimerie|Coopérative|École)/.test(name);
  if (/^[AEIOUÉÈH]/.test(name)) return `à l'${name}`;
  return fem ? `à la ${name}` : `au ${name}`;
}

export function chron(
  world: World, kind: ChronicleEvent['kind'], text: string,
  o: { person?: number; building?: number; x?: number; y?: number; by?: string } = {},
): void {
  const s = world.state;
  let x = o.x ?? -1, y = o.y ?? -1;
  if (x < 0 && o.building !== undefined && o.building >= 0) {
    const b = world.city.buildings[o.building]!;
    x = b.x + b.w / 2;
    y = b.y + b.h / 2;
  }
  s.chronicle.push({ id: s.nextEvent++, t: s.tick, kind, text, person: o.person ?? -1, building: o.building ?? -1, x, y, by: o.by ?? '' });
  if (s.chronicle.length > CHRONICLE_MAX) s.chronicle.splice(0, s.chronicle.length - CHRONICLE_MAX);
}

export function note(world: World, p: Person, text: string): void {
  p.journal.push({ t: world.state.tick, s: text });
  if (p.journal.length > JOURNAL_MAX) p.journal.shift();
}
