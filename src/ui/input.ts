// Gestes : glisser pour se déplacer, pincer ou molette pour zoomer, toucher
// pour sélectionner. Ne touche qu'à la caméra ; la sélection passe par un rappel.

import type { Camera } from '../render/camera';

export interface InputHandlers {
  onTap(sx: number, sy: number): void;
  onMove?(sx: number, sy: number): void;
  onUserPan?(): void;
}

export class Input {
  private pointers = new Map<number, { x: number; y: number }>();
  private downX = 0;
  private downY = 0;
  private downT = 0;
  private moved = false;
  private pinchDist = 0;
  private vx = 0;
  private vy = 0;
  private lastT = 0;
  private zoomTarget = 0;
  private zoomX = 0;
  private zoomY = 0;

  constructor(private el: HTMLElement, private cam: Camera, private handlers: InputHandlers) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private pos(e: PointerEvent | WheelEvent): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private down = (e: PointerEvent): void => {
    this.el.setPointerCapture(e.pointerId);
    const [x, y] = this.pos(e);
    this.pointers.set(e.pointerId, { x, y });
    this.vx = this.vy = 0;
    this.zoomTarget = 0;
    if (this.pointers.size === 1) {
      this.downX = x;
      this.downY = y;
      this.downT = performance.now();
      this.moved = false;
    } else {
      this.moved = true;
      this.pinchDist = this.spread();
    }
  };

  private spread(): number {
    const p = [...this.pointers.values()];
    if (p.length < 2) return 0;
    return Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y);
  }

  private move = (e: PointerEvent): void => {
    const [x, y] = this.pos(e);
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      this.handlers.onMove?.(x, y);
      return;
    }
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    if (this.pointers.size === 1) {
      if (!this.moved && Math.hypot(x - this.downX, y - this.downY) < 7) return;
      if (!this.moved) this.handlers.onUserPan?.();
      this.moved = true;
      this.cam.panPixels(dx, dy);
      const now = performance.now();
      const dt = Math.max(1, now - this.lastT);
      this.lastT = now;
      this.vx = this.vx * 0.6 + (dx / dt) * 0.4;
      this.vy = this.vy * 0.6 + (dy / dt) * 0.4;
    } else if (this.pointers.size === 2) {
      // Pincement : zoom autour du milieu des deux doigts, plus déplacement.
      const pts = [...this.pointers.values()];
      const mx = (pts[0]!.x + pts[1]!.x) / 2;
      const my = (pts[0]!.y + pts[1]!.y) / 2;
      const d = this.spread();
      if (this.pinchDist > 0 && d > 0) this.cam.zoomAt(mx, my, d / this.pinchDist);
      this.pinchDist = d;
      this.cam.panPixels(dx / 2, dy / 2);
      this.handlers.onUserPan?.();
    }
  };

  private up = (e: PointerEvent): void => {
    const had = this.pointers.delete(e.pointerId);
    if (!had) return;
    if (this.pointers.size === 0) {
      const [x, y] = this.pos(e);
      if (!this.moved && performance.now() - this.downT < 500 && e.type === 'pointerup') {
        this.vx = this.vy = 0;
        this.handlers.onTap(x, y);
      } else if (performance.now() - this.lastT > 80) {
        this.vx = this.vy = 0;
      }
    } else {
      this.pinchDist = 0;
      this.vx = this.vy = 0;
    }
  };

  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    const [x, y] = this.pos(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    const base = this.zoomTarget || this.cam.zoom;
    this.zoomTarget = Math.max(this.cam.minZoom, Math.min(this.cam.maxZoom, base * Math.exp(-delta * 0.0016)));
    this.zoomX = x;
    this.zoomY = y;
  };

  /** Inertie du glissement et zoom adouci ; à appeler à chaque image. */
  update(dtMs: number): void {
    if (this.pointers.size === 0 && (Math.abs(this.vx) > 0.01 || Math.abs(this.vy) > 0.01)) {
      this.cam.panPixels(this.vx * dtMs, this.vy * dtMs);
      const decay = Math.exp(-dtMs / 260);
      this.vx *= decay;
      this.vy *= decay;
    }
    if (this.zoomTarget) {
      const t = 1 - Math.exp(-dtMs / 70);
      const z = this.cam.zoom + (this.zoomTarget - this.cam.zoom) * t;
      this.cam.zoomAt(this.zoomX, this.zoomY, z / this.cam.zoom);
      if (Math.abs(this.zoomTarget - this.cam.zoom) < 0.01 * this.cam.zoom) this.zoomTarget = 0;
    }
  }
}
