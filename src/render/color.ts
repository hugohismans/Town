// Petits utilitaires de couleur (hex -> rgb, mélange, assombrissement).

export type RGB = [number, number, number];

const cache = new Map<string, RGB>();

export function rgb(hex: string): RGB {
  let c = cache.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    cache.set(hex, c);
  }
  return c;
}

export function hex(c: RGB): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

/** Multiplie la luminosité (f < 1 assombrit). */
export function shade(color: string, f: number): string {
  const c = rgb(color);
  return hex([c[0] * f, c[1] * f, c[2] * f]);
}

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export function mulRGB(a: string, m: RGB): string {
  const c = rgb(a);
  return hex([(c[0] * m[0]) / 255, (c[1] * m[1]) / 255, (c[2] * m[2]) / 255]);
}

export function rgba(color: string, a: number): string {
  const c = rgb(color);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
