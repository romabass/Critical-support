import { Circle, Vec2, type Body, type Fixture, type World } from 'planck';

import type { ProjectileData } from '../data/ProjectileData';
import { clamp } from '../core/MathUtils';
import type { StructuralElement } from './StructuralElement';

export interface ProjectileContactInfo {
  readonly speed: number;
  readonly position: { x: number; y: number };
  readonly targetId: string | null;
  readonly mass: number;
}

export interface ProjectileUpdateResult {
  readonly expired: boolean;
  readonly bounceCount: number;
  readonly lastPosition: { x: number; y: number } | null;
}

/** Активный снаряд в мире. */
export interface ProjectileSnapshot {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly speed: number;
  readonly active: boolean;
  readonly data: ProjectileData;
}

/**
 * Управление активным снарядом: создание тела, отслеживание отскоков,
 * обработка попаданий и исчезновения. Физика отвечает за движение,
 * контроллер — за жизненный цикл и передачу событий.
 */
export class ProjectileController {
  private body: Body | null = null;
  private data: ProjectileData;
  private bounces = 0;
  private age = 0;
  private readonly trail: { x: number; y: number }[] = [];

  constructor(private readonly world: World) {
    this.data = {} as ProjectileData;
  }

  get active(): boolean {
    return this.body !== null;
  }

  get current(): ProjectileData {
    return this.data;
  }

  get bounceCount(): number {
    return this.bounces;
  }

  get ageSeconds(): number {
    return this.age;
  }

  get trailPoints(): readonly { x: number; y: number }[] {
    return this.trail;
  }

  get snapshot(): ProjectileSnapshot | null {
    if (!this.body) return null;
    const p = this.body.getPosition();
    return {
      id: this.data.id,
      x: p.x,
      y: p.y,
      angle: this.body.getAngle(),
      speed: this.body.getLinearVelocity().length(),
      active: this.body.isActive(),
      data: this.data,
    };
  }

  spawn(
    data: ProjectileData,
    position: { x: number; y: number },
    velocity: { x: number; y: number },
  ): Body {
    this.clear();
    this.data = data;
    this.bounces = 0;
    this.age = 0;
    this.trail.length = 0;

    const body = this.world.createBody({
      type: 'dynamic',
      position: Vec2(position.x, position.y),
      bullet: true,
      linearDamping: data.linearDamping,
      angularDamping: 0.02,
      allowSleep: false,
    });
    body.createFixture({
      shape: new Circle(data.radius),
      density: data.density,
      friction: data.friction,
      restitution: data.restitution,
      isSensor: false,
    });
    body.setLinearVelocity(Vec2(velocity.x, velocity.y));
    body.setAngularVelocity(6);
    body.setUserData({ kind: 'projectile', id: data.id });
    body.setBullet(true);
    this.body = body;
    return body;
  }

  clear(): void {
    if (this.body) {
      this.world.destroyBody(this.body);
      this.body = null;
    }
    this.trail.length = 0;
    this.bounces = 0;
    this.age = 0;
  }

  update(
    dt: number,
    bounds: { leftBound: number; rightBound: number; killY: number; ceilingY: number },
  ): ProjectileUpdateResult {
    if (!this.body) return { expired: false, bounceCount: this.bounces, lastPosition: null };
    this.age += dt;

    const p = this.body.getPosition();
    this.trail.push({ x: p.x, y: p.y });
    const maxTrail = Math.max(2, this.data.trailLength);
    while (this.trail.length > maxTrail) this.trail.shift();

    const out =
      p.x < bounds.leftBound ||
      p.x > bounds.rightBound ||
      p.y < bounds.killY ||
      p.y > bounds.ceilingY + 40;

    let expired = out;
    if (this.age >= this.data.lifetime) expired = true;
    if (this.bounces > this.data.maxBounces) expired = true;

    if (expired) {
      const lastPosition = { x: p.x, y: p.y };
      this.clear();
      return { expired: true, bounceCount: this.bounces, lastPosition };
    }

    // Снаряд считается потраченным, если он практически остановился.
    const speed = this.body.getLinearVelocity().length();
    if (this.age > 0.6 && speed < 1.2) {
      this.clear();
      return { expired: true, bounceCount: this.bounces, lastPosition: { x: p.x, y: p.y } };
    }

    return { expired: false, bounceCount: this.bounces, lastPosition: { x: p.x, y: p.y } };
  }

  registerBounce(): number {
    this.bounces++;
    return this.bounces;
  }

  /**
   * Обрабатывает контакт снаряда с элементом: урон, импульс, отскок.
   * Возвращает информацию о контакте для системы разрушения.
   */
  resolveContact(
    fixture: Fixture,
    target: StructuralElement | null,
    impulse: number,
  ): ProjectileContactInfo | null {
    if (!this.body) return null;
    const position = this.body.getPosition();
    const speed = this.body.getLinearVelocity().length();
    const impulseScale = Math.max(0, impulse) * 0.0004;
    const materialId = target?.material.id ?? 'ground';
    const impulseFactor = this.data.impulseByMaterial[materialId] ?? 1;
    const effectiveImpulse =
      this.data.impulse * impulseFactor * clamp(speed / this.data.maxSpeed, 0.15, 1.5) +
      impulseScale * 100;

    void fixture;
    return {
      speed,
      position: { x: position.x, y: position.y },
      targetId: target?.id ?? null,
      mass: effectiveImpulse,
    };
  }

  /** Толчок снаряда в направлении от цели (для реалистичного отскока). */
  applyReaction(contactPoint: { x: number; y: number }): void {
    if (!this.body) return;
    const p = this.body.getPosition();
    let dx = p.x - contactPoint.x;
    let dy = p.y - contactPoint.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const v = this.body.getLinearVelocity();
    const speed = v.length();
    if (speed < 0.5) return;
    const reflect = 1 + this.data.restitution;
    this.body.setLinearVelocity(Vec2(dx * speed * reflect, dy * speed * reflect));
  }

  /** Дополнительный импульс элементу от попадания снаряда. */
  static transferImpulse(
    element: StructuralElement,
    impulse: { x: number; y: number },
    magnitude: number,
  ): void {
    const p = element.getPosition();
    element.body.applyLinearImpulse(
      Vec2(impulse.x * magnitude, impulse.y * magnitude),
      Vec2(p.x, p.y),
      true,
    );
  }
}
