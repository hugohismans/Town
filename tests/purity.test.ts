import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = (d: string) => readdirSync(join(__dirname, '..', 'src', d)).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(join(__dirname, '..', 'src', d, f), 'utf8')] as const);

describe('séparation des couches', () => {
  it('sim/ est pure : ni aléa caché, ni horloge, ni DOM, ni fonction transcendante', () => {
    const banned = [/Math\.random/, /Date\.now/, /new Date/, /performance\./, /\bdocument\b/, /\bwindow\b/, /requestAnimationFrame/, /localStorage/, /Math\.(sin|cos|tan|atan2?|pow|exp|log|hypot)\b/, /from '\.\.\/(render|ui)/];
    for (const [name, src] of dir('sim')) {
      const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const re of banned) expect(re.test(code), `${name} contient ${re}`).toBe(false);
    }
  });
  it("render/ ne dépend pas de ui/, et ui/ n'importe de sim/ que des types et des lectures", () => {
    for (const [name, src] of dir('render')) expect(/from '\.\.\/ui/.test(src), name).toBe(false);
    for (const [name, src] of dir('ui')) {
      // L'interface ne doit jamais faire avancer ni modifier la simulation elle-même.
      expect(/\b(step|restore|createWorld|applyCommands)\(/.test(src), name).toBe(false);
    }
  });
});
