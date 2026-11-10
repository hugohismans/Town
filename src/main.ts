// Point d'entrée : relie la simulation, le rendu et l'interface.
// C'est le seul fichier qui connaît les trois couches.

import './ui/style.css';
import { Renderer, type Selection } from './render/renderer';
import * as sim from './sim';
import { TICKS_PER_SEC, createWorld, restore, seedFromString, snapshot, step, submit, type World } from './sim';
import { Input } from './ui/input';
import { Ui } from './ui/ui';

const SAVE_KEY = 'ville-vivante:save';
const PLAYER_KEY = 'ville-vivante:player';
const canvas = document.getElementById('city') as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

const store = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* stockage plein ou interdit */ } },
};

// En solo, l'identité du joueur est locale. Demain, elle viendra du serveur.
let playerId = store.get(PLAYER_KEY) ?? '';
if (!playerId) {
  playerId = `esprit-${Math.random().toString(36).slice(2, 8)}`;
  store.set(PLAYER_KEY, playerId);
}

function load(): World {
  const forced = params.get('seed');
  if (forced !== null) return createWorld(/^-?\d+$/.test(forced) ? Number(forced) | 0 : seedFromString(forced));
  const saved = store.get(SAVE_KEY);
  if (saved) {
    try { return restore(saved); } catch (err) { console.warn('Sauvegarde illisible, nouvelle ville.', err); }
  }
  return createWorld(2026);
}

let world: World = load();
const renderer = new Renderer(canvas, world);
let selection: Selection = null;
let follow = false;
let speed = Number(params.get('speed') ?? 1);
let labels = true;
let fly: { x: number; y: number; zoom: number; t: number } | null = null;

function save(): void {
  if (params.get('seed') !== null) return; // ville d'essai : on ne l'enregistre pas
  store.set(SAVE_KEY, snapshot(world));
}

const ui = new Ui(document.getElementById('ui') as HTMLElement, {
  world: () => world,
  playerId,
  // Toute influence du joueur passe par ici : une commande sérialisable, datée du prochain tick.
  send: (type, targetId, p = {}) => submit(world, { tick: world.state.tick + 1, playerId, type, targetId, params: p }),
  select: (sel, flyTo = false) => {
    selection = sel;
    follow = false;
    if (sel && flyTo) {
      const pos = sel.type === 'person' ? renderer.drawnPos(world, sel.id) : null;
      const b = sel.type === 'building' ? world.city.buildings[sel.id]! : null;
      if (pos) fly = { x: pos[0], y: pos[1], zoom: Math.max(renderer.cam.zoom, 70), t: 0 };
      else if (b) fly = { x: b.x + b.w / 2, y: b.y + b.h / 2, zoom: Math.max(renderer.cam.zoom, 60), t: 0 };
      if (sel.type === 'person') follow = true;
    }
  },
  selection: () => selection,
  flyTo: (x, y, zoom = 70) => { fly = { x, y, zoom: Math.max(renderer.cam.zoom, zoom), t: 0 }; follow = false; },
  setSpeed: (n) => { speed = n; },
  speed: () => speed,
  setFollow: (on) => { follow = on; if (on) fly = null; },
  following: () => follow,
  newCity: (name) => {
    const seed = name ? seedFromString(name) : (Math.random() * 0x7fffffff) | 0;
    world = createWorld(seed);
    selection = null;
    follow = false;
    renderer.setWorld(world);
    fitCamera();
    save();
    ui.update(true);
  },
  toggleLabels: () => (labels = !labels),
  night: () => renderer.day.night,
});

function fitCamera(): void {
  const phone = window.innerWidth < 760;
  renderer.cam.fit(world.city.w, world.city.h, phone ? 110 : 60, phone ? 60 : 0);
}
fitCamera();

const input = new Input(canvas, renderer.cam, {
  onTap: (sx, sy) => {
    const hit = renderer.pick(sx, sy);
    if (ui.wantsTarget()) { ui.provideTarget(hit); return; }
    selection = hit;
    follow = false;
    // Sur téléphone, la fiche couvre le bas de l'écran : on remonte la cible si elle serait cachée.
    if (hit && window.innerWidth < 760 && sy > renderer.cam.h * 0.4) {
      const [wx, wy] = renderer.cam.toWorld(sx, sy);
      const lift = (renderer.cam.h * 0.2) / (renderer.cam.zoom * 0.25) / 2;
      fly = { x: wx + lift, y: wy + lift, zoom: renderer.cam.zoom, t: 0 };
    }
    ui.update(true);
  },
  onUserPan: () => { follow = false; fly = null; },
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === ' ') { speed = speed === 0 ? 1 : 0; e.preventDefault(); }
  else if (e.key === '1') speed = 1;
  else if (e.key === '2') speed = 4;
  else if (e.key === '3') speed = 16;
  else if (e.key === 'Escape') { if (ui.wantsTarget()) ui.cancelTarget(); else selection = null; }
  else return;
  ui.update(true);
});

let acc = 0;
let last = performance.now();
let fps = 60;
let uiClock = 0;
let saveClock = 0;

function frame(now: number): void {
  const dt = Math.min(250, now - last);
  last = now;
  fps += (1000 / Math.max(1, dt) - fps) * 0.05;
  input.update(dt);

  // Pas fixe : la simulation avance par ticks entiers, le rendu interpole entre deux ticks.
  acc += (dt / 1000) * TICKS_PER_SEC * speed;
  let n = 0;
  while (acc >= 1 && n < 48) {
    renderer.capture(world);
    step(world);
    acc -= 1;
    n++;
  }
  if (acc > 4) acc = 0;

  const cam = renderer.cam;
  if (fly) {
    fly.t = Math.min(1, fly.t + dt / 650);
    const k = 1 - Math.exp(-dt / 140);
    cam.x += (fly.x - cam.x) * k;
    cam.y += (fly.y - cam.y) * k;
    cam.zoom += (fly.zoom - cam.zoom) * k;
    if (fly.t >= 1 && Math.abs(fly.x - cam.x) + Math.abs(fly.y - cam.y) < 0.05) fly = null;
  } else if (follow && selection?.type === 'person') {
    const pos = renderer.drawnPos(world, selection.id);
    if (pos) {
      const k = 1 - Math.exp(-dt / 220);
      // Sur téléphone, la fiche occupe le bas de l'écran : on cadre un peu plus haut.
      const lift = window.innerWidth < 760 ? (cam.h * 0.2) / (cam.zoom * 0.25) / 2 : 0;
      cam.x += (pos[0] + lift - cam.x) * k;
      cam.y += (pos[1] + lift - cam.y) * k;
    }
  }

  renderer.render(world, { alpha: speed === 0 ? 1 : Math.min(1, acc), timeMs: now, selection, labels });

  uiClock += dt;
  if (uiClock > 200) { uiClock = 0; ui.update(); }
  saveClock += dt;
  if (saveClock > 20000) { saveClock = 0; save(); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); else last = performance.now(); });
window.addEventListener('pagehide', save);

// Poignée de débogage (console et tests navigateur).
Object.assign(window as unknown as Record<string, unknown>, {
  ville: {
    get world() { return world; },
    renderer,
    sim,
    ui,
    get fps() { return fps; },
    setSpeed(s: number) { speed = s; },
    select(sel: Selection) { selection = sel; ui.update(true); },
  },
});
