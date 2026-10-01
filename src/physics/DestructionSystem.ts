import { Vec2 } from 'planck';

import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import { clamp } from '../core/MathUtils';
import type { MaterialId } from '../data/MaterialProperties';
import { getMaterial } from '../data/MaterialProperties';
import type { ProjectileData } from '../data/ProjectileData';
import type { StructuralConnection } from './StructuralConnection';
import type { StructuralElement } from './StructuralElement';
import type { StructuralGraph } from './StructuralGraph';

export interface ImpactReport {
  readonly targetId: string | null;
  readonly damageApplied: number;
  readonly impulseMagnitude: number;
  readonly destroyed: boolean;
  readonly brokenConnections: string[];
  readonly weakenedConnections: string[];
  readonly point: { x: number; y: number };
  readonly speed: number;
}

export interface CollapseReport {
  readonly elementIds: string[];
  readonly mass: number;
}

/**
 * Система разрушения: переводит физические контакты в урон, ломает связи,
 * помечает элементы разрушенными и инициирует пересчёт графа.
 * Не содержит логики UI или счёта — только разрушение.
 */
export interface DestructionConfig {
  /** Ниже этой скорости соударение считается «покачиванием», а не ударом. */
  readonly minImpactSpeed: number;
  /** Сколько единиц урона даёт каждый джоуль энергии соударения. */
  readonly damagePerJoule: number;
  /** Доля урона, достающаяся элементу (остальное — второму участнику). */
  readonly damageShare: number;
  /** Потолок урона от одного удара, чтобы обвал не превращался в пар. */
  readonly maxImpactDamage: number;
  /** Урон ниже порога не учитывается вовсе. */
  readonly minDamage: number;
}

export const DEFAULT_DESTRUCTION: DestructionConfig = {
  minImpactSpeed: 2.6,
  damagePerJoule: 0.18,
  damageShare: 0.55,
  maxImpactDamage: 260,
  minDamage: 2,
};

/** Приведённая масса: для пары «динамический — статический» берётся масса динамического. */
function reducedMassOf(a: StructuralElement, b: StructuralElement): number {
  const ma = a.body.isStatic() ? Number.POSITIVE_INFINITY : a.mass;
  const mb = b.body.isStatic() ? Number.POSITIVE_INFINITY : b.mass;
  if (!Number.isFinite(ma)) return mb;
  if (!Number.isFinite(mb)) return ma;
  const sum = ma + mb;
  return sum > 0 ? (ma * mb) / sum : 0;
}

export class DestructionSystem {
  private pendingRepairs = new Set<string>();

  constructor(
    private readonly graph: StructuralGraph,
    private readonly events: EventBus<GameEvents>,
    private readonly config: DestructionConfig = DEFAULT_DESTRUCTION,
  ) {}

  /**
   * Обрабатывает попадание снаряда в элемент: урон, импульс, разрушение связей.
   */
  applyProjectileImpact(options: {
    projectile: ProjectileData;
    target: StructuralElement | null;
    point: { x: number; y: number };
    speed: number;
    direction: { x: number; y: number };
  }): ImpactReport {
    const { projectile, target, point, speed, direction } = options;
    const broken: string[] = [];
    const weakened: string[] = [];
    let damageApplied = 0;
    let destroyed = false;
    let impulseMagnitude = 0;

    const nearby = this.findElementsInRadius(point.x, point.y, projectile.connectionBreakRadius);

    for (const element of nearby) {
      const distance = Math.hypot(
        element.getPosition().x - point.x,
        element.getPosition().y - point.y,
      );
      const falloff = clamp(1 - distance / Math.max(projectile.connectionBreakRadius, 1e-3), 0, 1);

      if (element === target) {
        const materialId = element.material.id as MaterialId;
        const damageFactor = projectile.damageByMaterial[materialId] ?? 1;
        const rawDamage =
          projectile.damage * damageFactor * clamp(speed / projectile.maxSpeed, 0.2, 1.4);
        const info = element.applyDamage(rawDamage, 'projectile', projectile.id);
        damageApplied += info.appliedDamage;
        destroyed = destroyed || element.isDestroyed;

        const impulse = projectile.impulse * (projectile.impulseByMaterial[materialId] ?? 1);
        impulseMagnitude = Math.max(impulseMagnitude, impulse);
        element.body.applyLinearImpulse(
          Vec2(direction.x * impulse, direction.y * impulse),
          Vec2(point.x, point.y),
          true,
        );

        this.events.emit('element:damaged', {
          elementId: element.id,
          damage: info.appliedDamage,
          health: element.health,
          kind: 'projectile',
        });

        if (element.isDestroyed) {
          this.onElementDestroyed(element, 'projectile');
        }
        if (element.protectable) {
          this.events.emit('generator:damaged', {
            elementId: element.id,
            health: element.health,
            damagePercent: element.damagePercent,
          });
        }
      } else if (falloff > 0.05) {
        // Соседние элементы получают меньший урон от ударной волны.
        const splashDamage = projectile.damage * 0.22 * falloff;
        const info = element.applyDamage(splashDamage, 'impact', projectile.id);
        damageApplied += info.appliedDamage;
        if (info.appliedDamage > 0) {
          this.events.emit('element:damaged', {
            elementId: element.id,
            damage: info.appliedDamage,
            health: element.health,
            kind: 'impact',
          });
        }
        if (element.isDestroyed) {
          destroyed = true;
          this.onElementDestroyed(element, 'impact');
        }
      }

      // Ослабление связей в радиусе действия снаряда.
      for (const connection of this.graph.getConnectionsFor(element.id)) {
        if (connection.isBroken) continue;
        const isDirect = element === target;
        const impulse =
          (isDirect ? projectile.impulse * 0.55 : projectile.impulse * 0.2 * falloff) *
          (1 - distance / Math.max(projectile.connectionBreakRadius, 1e-3));
        if (impulse <= 0) continue;
        const wasBroken = connection.applyImpulse(impulse);
        if (wasBroken) {
          broken.push(connection.id);
          this.onConnectionBroken(connection, element.id);
        } else {
          weakened.push(connection.id);
        }
      }
    }

    if (broken.length > 0 || destroyed) this.graph.markDirty();

    this.events.emit('projectile:impact', {
      speed,
      x: point.x,
      y: point.y,
    });

    return {
      targetId: target?.id ?? null,
      damageApplied,
      impulseMagnitude,
      destroyed,
      brokenConnections: broken,
      weakenedConnections: weakened,
      point,
      speed,
    };
  }

  /**
   * Обрабатывает столкновение двух элементов.
   *
   * Урон считается от энергии соударения (0.5·m_eff·v²), поэтому тяжёлый блок,
   * падающий с высоты, ломает и себя, и то, что стоит под ним. Именно этот
   * механизм превращает точное попадание в цепную реакцию — основу геймплея.
   */
  applyElementCollision(a: StructuralElement, b: StructuralElement, impactSpeed: number): void {
    if (impactSpeed < this.config.minImpactSpeed) return;

    const reducedMass = reducedMassOf(a, b);
    const energy = 0.5 * reducedMass * impactSpeed * impactSpeed;
    const rawDamage = Math.min(this.config.maxImpactDamage, energy * this.config.damagePerJoule);
    if (rawDamage < this.config.minDamage) return;

    for (const [self, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const info = self.applyDamage(rawDamage * this.config.damageShare, 'collapse', other.id);
      if (info.appliedDamage > 0.5) {
        this.events.emit('element:damaged', {
          elementId: self.id,
          damage: info.appliedDamage,
          health: self.health,
          kind: 'collapse',
        });
      }
      if (self.isDestroyed) this.onElementDestroyed(self, 'collapse');
    }
  }

  /** Разрушение связи с уведомлением. */
  onConnectionBroken(connection: StructuralConnection, elementId: string): void {
    connection.breakInternal();
    connection.brokenAt = performance.now();
    this.events.emit('connection:broken', {
      connectionId: connection.id,
      elementId,
      loadRatio: connection.loadRatio,
    });
    this.graph.markDirty();
  }

  /** Элемент достиг нулевого здоровья. */
  onElementDestroyed(
    element: StructuralElement,
    kind: 'projectile' | 'impact' | 'collapse' | 'critical',
  ): void {
    if (element.destroyedAt !== null) return;
    element.destroyedAt = performance.now();

    // Все связи элемента разрушаются.
    for (const connection of this.graph.getConnectionsFor(element.id)) {
      if (connection.isBroken) continue;
      this.onConnectionBroken(connection, element.id);
    }

    const pos = element.getPosition();
    this.events.emit('element:destroyed', {
      elementId: element.id,
      group: element.group,
      mass: element.mass,
      x: pos.x,
      y: pos.y,
      kind,
    });

    if (element.critical) {
      // Критическая опора: наносит дополнительный урон элементам над ней.
      this.criticalCollapse(element);
    }

    this.graph.markDirty();
  }

  /**
   * Цепная реакция от разрушения критической опоры.
   *
   * Высота берётся из исходной схемы, а не из текущей позиции: упавшая колонна
   * не должна «обрушивать» всё, что оказалось выше неё после падения, — иначе
   * цепная реакция била бы по элементам, которые стояли ниже.
   */
  private criticalCollapse(origin: StructuralElement): void {
    const originY = origin.definition.y;
    const above = this.graph.elements.filter(
      (el) => el.id !== origin.id && !el.isDestroyed && el.definition.y > originY + 0.5,
    );
    for (const element of above) {
      const info = element.applyDamage(element.maxHealth * 0.12, 'critical', origin.id);
      this.events.emit('element:damaged', {
        elementId: element.id,
        damage: info.appliedDamage,
        health: element.health,
        kind: 'critical',
      });
      if (element.isDestroyed) this.onElementDestroyed(element, 'critical');
    }
  }

  /** Элементы в радиусе от точки. */
  findElementsInRadius(x: number, y: number, radius: number): StructuralElement[] {
    if (radius <= 0) return [];
    const r2 = radius * radius;
    return this.graph.elements.filter((el) => {
      if (el.isDestroyed) return false;
      const p = el.getPosition();
      const dx = p.x - x;
      const dy = p.y - y;
      return dx * dx + dy * dy <= r2;
    });
  }

  /** Элементы выше уровня — для подсчёта потери опор. */
  findElementsAbove(y: number): StructuralElement[] {
    return this.graph.elements.filter((el) => !el.isDestroyed && el.getPosition().y > y);
  }

  /** Масса разрушенных элементов группы. */
  destroyedMassForGroup(group: string): number {
    let mass = 0;
    for (const el of this.graph.elements) {
      if (el.group === group && el.isDestroyed) mass += el.mass;
    }
    return mass;
  }

  /** Регистрирует повреждение материала (для preserve_material). */
  static materialDamagePercent(
    elements: readonly StructuralElement[],
    material: MaterialId,
  ): number {
    const list = elements.filter((el) => el.material.id === material);
    if (list.length === 0) return 0;
    let total = 0;
    for (const el of list) total += el.damagePercent;
    return clamp(total / list.length, 0, 100);
  }

  /** Элемент, вышедший за пределы мира — помечается разрушенным. */
  handleOutOfBounds(element: StructuralElement, killY: number): boolean {
    if (element.isDestroyed) return false;
    const p = element.getPosition();
    if (p.y < killY) {
      element.health = 0;
      element.state = 'destroyed';
      this.onElementDestroyed(element, 'collapse');
      return true;
    }
    return false;
  }

  /** Ставит в очередь «ремонт» — используется для отладки и тестов. */
  queueRepair(elementId: string): void {
    this.pendingRepairs.add(elementId);
  }

  flushRepairs(): string[] {
    const ids = [...this.pendingRepairs];
    this.pendingRepairs.clear();
    return ids;
  }

  /** Материал элемента для отчёта. */
  materialOf(element: StructuralElement): MaterialId {
    return getMaterial(element.material.id).id;
  }
}
