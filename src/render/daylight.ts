// Lumière du jour : fonction pure de la minute de la journée.

import { hex, mulRGB, rgb, type RGB } from './color';

export const NIGHT_AMBIENT: RGB = [84, 100, 168];

export interface Daylight {
  night: number; // 0 = plein jour, 1 = nuit
  ambient: RGB; // couleur multiplicative appliquée au sol et aux personnages
  ambientCss: string;
  warm: number; // intensité du voile doré (aube, crépuscule)
  skyTop: string;
  skyBottom: string;
  level: number; // night quantifié sur 0..16 (clé de cache)
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp3 = (a: string, b: string, t: number) => {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
};

export function daylight(minute: number): Daylight {
  const h = minute / 60;
  const night = h < 12 ? 1 - smooth(5.4, 7.2, h) : smooth(19.3, 21.2, h);
  const warm = Math.max(0, 1 - Math.abs(night - 0.42) / 0.42) * (h < 12 ? 0.7 : 1);
  const amb: RGB = [
    255 + (NIGHT_AMBIENT[0] - 255) * night,
    255 + (NIGHT_AMBIENT[1] - 255) * night,
    255 + (NIGHT_AMBIENT[2] - 255) * night,
  ];
  // Trois ciels : jour, heure dorée, nuit.
  const dusk = Math.max(0, 1 - Math.abs(night - 0.45) / 0.45);
  let top = lerp3('#bfe3f4', '#0b1130', night);
  let bottom = lerp3('#e9f3ea', '#1a2146', night);
  top = lerp3(top, '#6a6fb0', dusk * 0.8);
  bottom = lerp3(bottom, '#f6b58a', dusk * 0.9);
  return {
    night, ambient: amb, ambientCss: hex(amb), warm, skyTop: top, skyBottom: bottom,
    level: Math.round(night * 16),
  };
}

const tintCache = new Map<string, string>();
/** Couleur d'un élément dessiné en direct (personnage, voiture) sous la lumière courante. */
export function tint(color: string, d: Daylight): string {
  if (d.level === 0) return color;
  const key = color + d.level;
  let c = tintCache.get(key);
  if (!c) {
    const n = d.level / 16;
    c = mulRGB(color, [255 + (NIGHT_AMBIENT[0] - 255) * n, 255 + (NIGHT_AMBIENT[1] - 255) * n, 255 + (NIGHT_AMBIENT[2] - 255) * n]);
    tintCache.set(key, c);
  }
  return c;
}
