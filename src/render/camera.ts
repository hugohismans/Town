// Caméra isométrique. Monde (tuiles) <-> écran (pixels CSS).

export class Camera {
  x = 0;
  y = 0;
  zoom = 24; // largeur d'une tuile à l'écran, en pixels CSS
  w = 1;
  h = 1;
  minZoom = 4;
  maxZoom = 190;
  worldW = 1;
  worldH = 1;

  sx(wx: number, wy: number): number {
    return this.w / 2 + (wx - this.x - (wy - this.y)) * this.zoom * 0.5;
  }
  sy(wx: number, wy: number): number {
    return this.h / 2 + (wx - this.x + (wy - this.y)) * this.zoom * 0.25;
  }
  toWorld(sx: number, sy: number): [number, number] {
    const a = (sx - this.w / 2) / (this.zoom * 0.5);
    const b = (sy - this.h / 2) / (this.zoom * 0.25);
    return [this.x + (a + b) / 2, this.y + (b - a) / 2];
  }
  /** Zoom autour d'un point de l'écran (le point du monde sous le doigt ne bouge pas). */
  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    const [nx, ny] = this.toWorld(sx, sy);
    this.x += wx - nx;
    this.y += wy - ny;
    this.clamp();
  }
  panPixels(dx: number, dy: number): void {
    const a = dx / (this.zoom * 0.5);
    const b = dy / (this.zoom * 0.25);
    this.x -= (a + b) / 2;
    this.y -= (b - a) / 2;
    this.clamp();
  }
  clamp(): void {
    this.x = Math.max(-2, Math.min(this.worldW + 2, this.x));
    this.y = Math.max(-2, Math.min(this.worldH + 2, this.y));
  }
  /** Cadre la ville entière. */
  fit(worldW: number, worldH: number, padTop = 0, padBottom = 0): void {
    this.worldW = worldW;
    this.worldH = worldH;
    const availH = Math.max(120, this.h - padTop - padBottom);
    const fit = Math.min(this.w / ((worldW + worldH) * 0.5), availH / ((worldW + worldH) * 0.25 + 1.5));
    this.minZoom = fit * 0.7;
    // En portrait, on démarre plus près : la ville entière serait minuscule.
    this.zoom = fit * (this.h > this.w * 1.2 ? 1.9 : 0.98);
    this.x = worldW / 2;
    this.y = worldH / 2;
    // Décale le centre pour tenir compte des bandeaux d'interface.
    this.panPixels(0, (padTop - padBottom) / 2 + this.zoom * 0.3);
  }
}
