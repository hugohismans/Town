// PRNG déterministe (mulberry32). L'état tient dans un entier 32 bits, donc
// dans le snapshot JSON. Aucune autre source d'aléa n'est permise dans sim/.

export class Rng {
  s: number;
  constructor(seed: number) {
    this.s = seed | 0;
  }
  /** Flottant uniforme dans [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Entier dans [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** Entier dans [a, b] inclus. */
  between(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)] as T;
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i] as T;
      arr[i] = arr[j] as T;
      arr[j] = t;
    }
    return arr;
  }
}

/** Hachage entier -> uint32, pour les variations stables (couleurs, phases). */
export function hash32(a: number, b = 0): number {
  let h = (a | 0) ^ Math.imul((b | 0) + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Hachage -> flottant dans [0, 1). */
export function hash01(a: number, b = 0): number {
  return hash32(a, b) / 4294967296;
}

/** FNV-1a 32 bits d'une chaîne, rendu en hexadécimal. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Graine entière à partir d'un texte quelconque (nom de ville, etc.). */
export function seedFromString(str: string): number {
  return parseInt(fnv1a(str), 16) | 0;
}
