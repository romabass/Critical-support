import { clamp, damp } from '../core/MathUtils';

export interface CameraTarget {
  readonly centerX: number;
  readonly centerY: number;
  readonly zoom?: number;
}

export interface CameraLimits {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZoom: number;
  readonly maxZoom: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * 2D-камера: позиция, масштаб, тряска, следование за целью.
 * Только трансформация — не знает о физике и UI.
 */
export class CameraController {
  private centerX: number;
  private centerY: number;
  private zoomValue: number;
  private targetZoom: number;
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;
  private shakeIntensity = 0;
  private shakeTime = 0;
  private bounds: CameraLimits | null = null;
  private readonly baseFov: number;

  constructor(
    initial: CameraTarget,
    private viewport: Viewport,
    baseFov = 34,
  ) {
    this.centerX = initial.centerX;
    this.centerY = initial.centerY;
    this.zoomValue = initial.zoom ?? 1;
    this.targetZoom = this.zoomValue;
    this.baseFov = baseFov;
  }

  get center(): { x: number; y: number } {
    return { x: this.centerX, y: this.centerY };
  }

  get zoom(): number {
    return this.zoomValue;
  }

  get worldHalfHeight(): number {
    return this.baseFov / (2 * this.zoomValue);
  }

  get worldHalfWidth(): number {
    return this.worldHalfHeight * (this.viewport.width / Math.max(1, this.viewport.height));
  }

  /** Границы видимой области с учётом тряски. */
  get visibleWorldRect(): { left: number; right: number; bottom: number; top: number } {
    const cx = this.centerX + this.shakeOffsetX;
    const cy = this.centerY + this.shakeOffsetY;
    const hw = this.worldHalfWidth;
    const hh = this.worldHalfHeight;
    return { left: cx - hw, right: cx + hw, bottom: cy - hh, top: cy + hh };
  }

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
  }

  setBounds(bounds: CameraLimits | null): void {
    this.bounds = bounds;
  }

  setZoom(zoom: number): number {
    this.targetZoom = clamp(zoom, this.bounds?.minZoom ?? 0.4, this.bounds?.maxZoom ?? 3);
    return this.targetZoom;
  }

  addZoom(delta: number): number {
    return this.setZoom(this.targetZoom + delta);
  }

  /** Мгновенное перемещение камеры. */
  snapTo(x: number, y: number): void {
    this.centerX = x;
    this.centerY = y;
    this.clampCenter();
  }

  private targetX: number | null = null;
  private targetY: number | null = null;

  /** Плавное движение к точке. Скорость задаётся постоянной времени в update. */
  moveTo(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  follow(point: { x: number; y: number }): void {
    this.targetX = point.x;
    this.targetY = point.y;
  }

  /** Плавное следование за снарядом с удержанием в границах. */
  update(dt: number): void {
    if (this.targetX !== null && this.targetY !== null) {
      this.centerX = damp(this.centerX, this.targetX, 0.14, dt);
      this.centerY = damp(this.centerY, this.targetY, 0.14, dt);
    }
    this.zoomValue = damp(this.zoomValue, this.targetZoom, 0.12, dt);
    this.clampCenter();

    if (this.shakeIntensity > 0) {
      this.shakeTime += dt;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 2.4);
      const t = this.shakeTime * 42;
      this.shakeOffsetX = Math.sin(t) * this.shakeIntensity;
      this.shakeOffsetY = Math.cos(t * 1.37) * this.shakeIntensity;
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }
  }

  private clampCenter(): void {
    if (!this.bounds) return;
    this.centerX = clamp(this.centerX, this.bounds.minX, this.bounds.maxX);
    this.centerY = clamp(this.centerY, this.bounds.minY, this.bounds.maxY);
  }

  /** Тряска камеры. Интенсивность в метрах. */
  shake(intensity: number): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, Math.min(intensity, 1.6));
    this.shakeTime = 0;
  }

  get shakeLevel(): number {
    return this.shakeIntensity;
  }

  /** Экранные координаты → мировые. */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    const rect = this.visibleWorldRect;
    const nx = sx / this.viewport.width;
    const ny = sy / this.viewport.height;
    return {
      x: rect.left + nx * (rect.right - rect.left),
      y: rect.top - ny * (rect.top - rect.bottom),
    };
  }

  /** Мировые координаты → экранные. */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    const rect = this.visibleWorldRect;
    const nx = (wx - rect.left) / (rect.right - rect.left);
    const ny = (rect.top - wy) / (rect.top - rect.bottom);
    return { x: nx * this.viewport.width, y: ny * this.viewport.height };
  }

  /** Масштаб в пикселях на метр. */
  pixelsPerMeter(): number {
    return this.viewport.height / (this.worldHalfHeight * 2);
  }

  reset(initial: CameraTarget): void {
    this.centerX = initial.centerX;
    this.centerY = initial.centerY;
    this.targetZoom = initial.zoom ?? 1;
    this.zoomValue = this.targetZoom;
    this.targetX = null;
    this.targetY = null;
    this.shakeIntensity = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
  }
}
