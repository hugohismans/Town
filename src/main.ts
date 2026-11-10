// Point d'entrée : relie la simulation, le rendu et l'interface.
// C'est le seul fichier qui connaît les trois couches.

import './ui/style.css';
import { Renderer } from './render/renderer';
import { TICKS_PER_SEC, createWorld, step, type World } from './sim';
import { Input } from './ui/input';

const canvas = document.getElementById('city') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 2026) | 0;

let world: World = createWorld(seed);
const renderer = new Renderer(canvas, world);
const input = new Input(canvas, renderer.cam, { onTap: () => undefined });

let speed = Number(params.get('speed') ?? 1);
let acc = 0;
let last = performance.now();
let fps = 60;

function frame(now: number): void {
  const dt = Math.min(250, now - last);
  last = now;
  fps += (1000 / Math.max(1, dt) - fps) * 0.05;
  input.update(dt);
  acc += (dt / 1000) * TICKS_PER_SEC * speed;
  let n = 0;
  while (acc >= 1 && n < 64) {
    renderer.capture(world);
    step(world);
    acc -= 1;
    n++;
  }
  if (acc > 4) acc = 0;
  renderer.render(world, { alpha: Math.min(1, acc), timeMs: now, selection: null, labels: true });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.addEventListener('resize', () => renderer.resize());

// Poignée de débogage (console et tests navigateur).
Object.assign(window as unknown as Record<string, unknown>, {
  ville: {
    get world() { return world; },
    set world(w: World) { world = w; },
    renderer,
    get fps() { return fps; },
    setSpeed(s: number) { speed = s; },
  },
});
