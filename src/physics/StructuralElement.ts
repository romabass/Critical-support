import { Box, Circle, Polygon, Vec2, type Body, type World } from 'planck';

import { computeDamage, getMaterial, type MaterialProperties } from '../data/MaterialProperties';
import type { ElementDefinition } from '../data/LevelData';
import type { DamageKind } from '../data/MaterialProperties';
import { clamp } from '../core/MathUtils';

export type ElementState = 'intact' | 'damaged' | 'destroyed';

export interface ElementDamageInfo {
  readonly rawDamage: number;
  readonly appliedDamage: number;
  readonly kind: DamageKind;
  readonly impulse: number;
  readonly sourceId: string | null;
}

/**
 * Физический элемент конструкции: тело + материал + запас прочности + принадлежность к группе.
 * Логика урона и разрушения сосредоточена здесь; система разрушения вызывает её методы.
 */
export class StructuralElement {
  readonly id: string;
  readonly material: MaterialProperties;
  readonly definition: ElementDefinition;
  readonly group: string | null;
  readonly role: ElementDefinition['role'];
  readonly loadBearing: boolean;
  readonly critical: boolean;
  readonly protectable: boolean;
  readonly anchored: boolean;
  readonly label: string;

  body: Body;
  maxHealth: number;
  health: number;
  state: ElementState = 'intact';
  /** Накопленный урон в процентах от максимума (0..100). */
  damagePercent = 0;
  /** Плотность трещин 0..1 — управляет визуалом. */
  crackLevel = 0;
  destroyedAt: number | null = null;
  /** Подсчитывается один раз при создании, не меняется. */
  readonly mass: number;

  private readonly initialHealth: number;

  constructor(body: Body, definition: ElementDefinition) {
    this.body = body;
    this.definition = definition;
    this.id = definition.id;
    this.material = getMaterial(definition.material);
    this.group = definition.group ?? null;
    this.role = definition.role;
    this.loadBearing = definition.loadBearing ?? false;
    this.critical = definition.critical ?? false;
    this.protectable = definition.protectable ?? false;
    this.anchored = definition.anchored ?? false;
    this.label = definition.label ?? definition.id;
    this.maxHealth = definition.health ?? this.material.strength;
    this.initialHealth = this.maxHealth;
    this.health = this.maxHealth;
    this.mass = body.getMass();
  }

  get isDestroyed(): boolean {
    return this.state === 'destroyed';
  }

  get healthRatio(): number {
    return this.maxHealth > 0 ? clamp(this.health / this.maxHealth, 0, 1) : 0;
  }

  get damageRatio(): number {
    return clamp(this.damagePercent / 100, 0, 1);
  }

  /** Полностью ли восстановлен (для проверки отсутствия дубликатов урона). */
  get isPristine(): boolean {
    return this.health >= this.initialHealth - 1e-6 && this.state === 'intact';
  }

  getPosition(): { x: number; y: number } {
    const p = this.body.getPosition();
    return { x: p.x, y: p.y };
  }

  getAngle(): number {
    return this.body.getAngle();
  }

  /** Угол в градусах — используется рендерером. */
  angleDeg(): number {
    return (this.body.getAngle() * 180) / Math.PI;
  }

  getVelocity(): { x: number; y: number } {
    const v = this.body.getLinearVelocity();
    return { x: v.x, y: v.y };
  }

  getSpeed(): number {
    return this.body.getLinearVelocity().length();
  }

  /** Габариты в локальных осях с учётом поворота (для рендера и хит-тестов). */
  get halfExtents(): { width: number; height: number } {
    if (this.definition.shape === 'circle') {
      const r = this.definition.radius ?? this.definition.width / 2;
      return { width: r, height: r };
    }
    if (this.definition.shape === 'polygon' && this.definition.vertices) {
      let maxX = 0;
      let maxY = 0;
      for (const v of this.definition.vertices) {
        maxX = Math.max(maxX, Math.abs(v.x));
        maxY = Math.max(maxY, Math.abs(v.y));
      }
      return { width: maxX, height: maxY };
    }
    return { width: this.definition.width / 2, height: this.definition.height / 2 };
  }

  /** Расчёт урона с учётом материала. Возвращает фактически нанесённый урон. */
  applyDamage(
    rawDamage: number,
    kind: DamageKind = 'impact',
    sourceId: string | null = null,
  ): ElementDamageInfo {
    if (this.isDestroyed || rawDamage <= 0) {
      return { rawDamage, appliedDamage: 0, kind, impulse: 0, sourceId };
    }
    const applied = computeDamage(this.material, rawDamage, kind);
    // Неразрушимые материалы (генератор, грунт) накапливают повреждения,
    // но никогда не переходят в состояние destroyed.
    const floor = this.material.destructible ? 0 : Math.max(0.001, this.maxHealth * 0.001);
    this.health = Math.max(floor, this.health - applied);
    this.damagePercent = clamp((this.maxHealth - this.health) / this.maxHealth, 0, 1) * 100;

    const crackEnergy = 0.5 * this.mass * this.getSpeed() * this.getSpeed();
    if (crackEnergy > this.material.crackThreshold) {
      this.crackLevel = clamp(this.crackLevel + applied / this.maxHealth + 0.15, 0, 1);
    } else {
      this.crackLevel = clamp(this.crackLevel + applied / this.maxHealth, 0, 1);
    }

    if (this.health <= floor) {
      this.state = 'destroyed';
    } else if (this.damagePercent > 15) {
      this.state = 'damaged';
    } else {
      this.state = 'intact';
    }

    return { rawDamage, appliedDamage: applied, kind, impulse: 0, sourceId };
  }

  /** Восстанавливает элемент в исходное состояние. Используется при перезапуске. */
  reset(): void {
    this.health = this.maxHealth;
    this.state = 'intact';
    this.damagePercent = 0;
    this.crackLevel = 0;
    this.destroyedAt = null;
  }

  setInactive(inactive: boolean): void {
    this.body.setActive(!inactive);
  }

  /** Энергия движения — используется для классификации обломков. */
  get kineticEnergy(): number {
    const v = this.getSpeed();
    return 0.5 * this.mass * v * v;
  }
}

/** Создаёт физическое тело элемента по данным уровня. */
export function createElementBody(world: World, def: ElementDefinition): Body {
  const material = getMaterial(def.material);
  const isStatic = def.role === 'ground';
  const body = world.createBody({
    type: isStatic ? 'static' : 'dynamic',
    position: Vec2(def.x, def.y),
    angle: def.angle ?? 0,
    linearDamping: 0.04,
    angularDamping: 0.08,
    bullet: !isStatic && def.shape === 'circle',
  });

  const common = {
    density: material.density,
    friction: material.friction,
    restitution: material.restitution,
  };

  if (def.shape === 'circle') {
    body.createFixture({ shape: new Circle(def.radius ?? def.width / 2), ...common });
  } else if (def.shape === 'polygon' && def.vertices) {
    body.createFixture({ shape: new Polygon(def.vertices.map((v) => Vec2(v.x, v.y))), ...common });
  } else {
    body.createFixture({
      shape: new Box(def.width / 2, def.height / 2),
      ...common,
    });
  }

  body.setUserData({ kind: 'element', id: def.id });
  return body;
}
