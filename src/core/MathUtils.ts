import type { Vec2 } from 'planck';

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : clamp((value - a) / (b - a), 0, 1);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function length(x: number, y: number): number {
  return Math.hypot(x, y);
}

export function normalize(x: number, y: number): { x: number; y: number } {
  const len = Math.hypot(x, y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function toWorldVec(v: Vec2): { x: number; y: number } {
  return { x: v.x, y: v.y };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function pointInRect(px: number, py: number, rect: Rect): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

/** Проверка пересечения точки с расширенным прямоугольником (AABBs элементов). */
export function pointInExpandedRect(px: number, py: number, rect: Rect, margin: number): boolean {
  return (
    px >= rect.x - margin &&
    px <= rect.x + rect.width + margin &&
    py >= rect.y - margin &&
    py <= rect.y + rect.height + margin
  );
}

export function smoothStep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Экспоненциальное сглаживание, независимое от частоты кадров. */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target;
  const factor = 1 - Math.pow(0.5, dt / halfLife);
  return current + (target - current) * factor;
}

export function formatMass(mass: number): string {
  if (mass >= 1000) return `${(mass / 1000).toFixed(2)} т`;
  return `${Math.round(mass)} кг`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
