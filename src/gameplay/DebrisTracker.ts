import { clamp, pointInRect } from '../core/MathUtils';
import type { ZoneDefinition } from '../data/LevelData';
import type { StructuralElement } from '../physics/StructuralElement';

export interface TrackedDebris {
  readonly elementId: string;
  readonly mass: number;
  readonly group: string | null;
  x: number;
  y: number;
  zoneId: string | null;
  settled: boolean;
  settledAt: number | null;
  isLarge: boolean;
  outOfWorld: boolean;
}

/**
 * Отслеживание обломков: куда упало, в какой зоне, какая масса.
 * Обломки, покинувшие мир, теряются и не учитываются как попадание в зону.
 */
export class DebrisTracker {
  private readonly pieces = new Map<string, TrackedDebris>();
  private readonly largeDebrisMass: number;

  constructor(options: { largeDebrisMass?: number } = {}) {
    this.largeDebrisMass = options.largeDebrisMass ?? 50;
  }

  get count(): number {
    return this.pieces.size;
  }

  get all(): TrackedDebris[] {
    return [...this.pieces.values()];
  }

  has(elementId: string): boolean {
    return this.pieces.has(elementId);
  }

  get(elementId: string): TrackedDebris | undefined {
    return this.pieces.get(elementId);
  }

  /** Регистрирует новый обломок. Повторная регистрация того же элемента игнорируется. */
  register(element: StructuralElement, zoneId: string | null, now: number): TrackedDebris | null {
    const existing = this.pieces.get(element.id);
    if (existing) {
      // Не дублируем: только обновляем позицию.
      existing.x = element.getPosition().x;
      existing.y = element.getPosition().y;
      existing.zoneId = zoneId ?? existing.zoneId;
      return null;
    }
    const pos = element.getPosition();
    const piece: TrackedDebris = {
      elementId: element.id,
      mass: element.mass,
      group: element.group,
      x: pos.x,
      y: pos.y,
      zoneId,
      settled: false,
      settledAt: null,
      isLarge: element.mass >= this.largeDebrisMass,
      outOfWorld: false,
    };
    this.pieces.set(element.id, piece);
    void now;
    return piece;
  }

  /** Обновляет положение обломка и его состояние «осев». */
  update(element: StructuralElement, zoneId: string | null, settled: boolean, now: number): void {
    const piece = this.pieces.get(element.id);
    if (!piece) return;
    const pos = element.getPosition();
    piece.x = pos.x;
    piece.y = pos.y;
    piece.zoneId = zoneId ?? piece.zoneId;
    if (!piece.settled && settled) {
      piece.settled = true;
      piece.settledAt = now;
    } else if (piece.settled && !settled) {
      piece.settled = false;
      piece.settledAt = null;
    }
  }

  markOutOfWorld(elementId: string): void {
    const piece = this.pieces.get(elementId);
    if (piece) {
      piece.outOfWorld = true;
      piece.zoneId = null;
    }
  }

  remove(elementId: string): void {
    this.pieces.delete(elementId);
  }

  /** Суммарная масса обломков в зоне. */
  massInZone(zoneId: string, options: { largeOnly?: boolean } = {}): number {
    let mass = 0;
    for (const piece of this.pieces.values()) {
      if (piece.zoneId !== zoneId) continue;
      if (piece.outOfWorld) continue;
      if (options.largeOnly && !piece.isLarge) continue;
      mass += piece.mass;
    }
    return mass;
  }

  countInZone(zoneId: string): number {
    let count = 0;
    for (const piece of this.pieces.values()) {
      if (piece.zoneId === zoneId && !piece.outOfWorld) count++;
    }
    return count;
  }

  /** Список застрявших обломков, которые можно убрать. */
  getSettled(largeOnly = true): TrackedDebris[] {
    return this.all.filter((p) => p.settled && p.outOfWorld === false && (!largeOnly || p.isLarge));
  }

  clear(): void {
    this.pieces.clear();
  }

  /** Зона, содержащая точку (приоритет у красной). */
  static zoneAt(x: number, y: number, zones: readonly ZoneDefinition[]): ZoneDefinition | null {
    let greenHit: ZoneDefinition | null = null;
    for (const zone of zones) {
      const inside = pointInRect(x, y, zone);
      if (!inside) continue;
      if (zone.kind === 'red') return zone;
      greenHit = greenHit ?? zone;
    }
    return greenHit;
  }

  /** Относительное заполнение зоны, 0..N. */
  static fillRatio(zone: ZoneDefinition, debrisMass: number): number {
    const limit = zone.maximumDebrisMass ?? zone.targetDebrisMass ?? 1;
    return limit > 0 ? clamp(debrisMass / limit, 0, 10) : 0;
  }
}
