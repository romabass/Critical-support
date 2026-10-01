import type { ProjectileData } from '../data/ProjectileData';
import { clamp } from '../core/MathUtils';
import { degToRad } from '../core/MathUtils';

export interface LaunchSolution {
  readonly speed: number;
  readonly velocity: { x: number; y: number };
  readonly angleDeg: number;
  readonly power: number;
  /** Время полёта по параболе до возврата на исходную высоту. */
  readonly flightTime: number;
  /** Дальность по горизонтали на той же высоте. */
  readonly range: number;
  readonly maxHeight: number;
}

export interface TrajectoryPoint {
  readonly x: number;
  readonly y: number;
  /** Признак выхода за пределы игровой области. */
  readonly outOfBounds: boolean;
}

export interface TrajectoryOptions {
  readonly maxPoints?: number;
  readonly pointInterval?: number;
  readonly environment: {
    readonly leftBound: number;
    readonly rightBound: number;
    readonly ceilingY: number;
    readonly killY: number;
  };
  /** Линейное затухание снаряда для честного прогноза. */
  readonly linearDamping?: number;
}

/**
 * Баллистика: перевод силы и угла в скорость, прогноз траектории.
 * Прогноз использует ту же гравитацию и то же затухание, что и физика снаряда,
 * чтобы линия не расходилась с фактическим полётом.
 */
export class BallisticsController {
  private currentAngleDeg: number;
  private currentPower: number;
  private readonly data: ProjectileData;

  constructor(
    private readonly launcher: {
      x: number;
      y: number;
      minAngleDeg: number;
      maxAngleDeg: number;
      defaultAngleDeg: number;
      minPower: number;
      maxPower: number;
    },
    data: ProjectileData,
    initialAngleDeg?: number,
  ) {
    this.data = data;
    this.currentAngleDeg = clamp(
      initialAngleDeg ?? launcher.defaultAngleDeg,
      launcher.minAngleDeg,
      launcher.maxAngleDeg,
    );
    this.currentPower = launcher.minPower + (launcher.maxPower - launcher.minPower) * 0.5;
  }

  get angleDeg(): number {
    return this.currentAngleDeg;
  }

  get angleRad(): number {
    return degToRad(this.currentAngleDeg);
  }

  get power(): number {
    return this.currentPower;
  }

  get origin(): { x: number; y: number } {
    return { x: this.launcher.x, y: this.launcher.y };
  }

  setAngle(deg: number): number {
    this.currentAngleDeg = clamp(deg, this.launcher.minAngleDeg, this.launcher.maxAngleDeg);
    return this.currentAngleDeg;
  }

  addAngle(deltaDeg: number): number {
    return this.setAngle(this.currentAngleDeg + deltaDeg);
  }

  setPower(power: number): number {
    this.currentPower = clamp(power, this.launcher.minPower, this.launcher.maxPower);
    return this.currentPower;
  }

  addPower(delta: number): number {
    return this.setPower(this.currentPower + delta);
  }

  /** Скорость по силе: линейная интерполяция minSpeed..maxSpeed. */
  speedFromPower(power: number): number {
    const { minPower, maxPower } = this.launcher;
    const t =
      maxPower > minPower
        ? (clamp(power, minPower, maxPower) - minPower) / (maxPower - minPower)
        : 0;
    return this.data.minSpeed + (this.data.maxSpeed - this.data.minSpeed) * t;
  }

  /** Скорость из расстояния курсора до точки запуска (0..1). */
  speedFromDistance(distance: number, maxDistance = 9): number {
    return this.speedFromPower(
      clamp(distance / maxDistance, this.launcher.minPower, this.launcher.maxPower),
    );
  }

  powerFromDistance(distance: number, maxDistance = 9): number {
    return clamp(distance / maxDistance, this.launcher.minPower, this.launcher.maxPower);
  }

  solve(): LaunchSolution {
    const angle = this.angleRad;
    const speed = this.speedFromPower(this.currentPower);
    const gravity = this.gravity;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;
    const flightTime = vy > 0 ? (2 * vy) / gravity : 0;
    return {
      speed,
      velocity: { x: vx, y: vy },
      angleDeg: this.currentAngleDeg,
      power: this.currentPower,
      flightTime,
      range: vx * flightTime,
      maxHeight: this.origin.y + (vy * vy) / (2 * gravity),
    };
  }

  private gravity = 18;

  setGravity(gravity: number): void {
    this.gravity = gravity;
  }

  /** Направление полёта для отрисовки индикатора угла. */
  directionVector(): { x: number; y: number } {
    const angle = this.angleRad;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  /**
   * Прогноз траектории. Учитывает гравитацию и линейное затухание снаряда.
   * Точки равномерно распределены по времени полёта.
   */
  predict(options: TrajectoryOptions): TrajectoryPoint[] {
    const maxPoints = options.maxPoints ?? 90;
    const interval = options.pointInterval ?? 0.055;
    const dt = this.data.linearDamping > 0 ? interval : interval;
    const damping = this.data.linearDamping;
    const angle = this.angleRad;
    const speed = this.speedFromPower(this.currentPower);
    let x = this.origin.x;
    let y = this.origin.y;
    let vx = Math.cos(angle) * speed;
    let vy = Math.sin(angle) * speed;
    const points: TrajectoryPoint[] = [{ x, y, outOfBounds: false }];

    for (let i = 0; i < maxPoints; i++) {
      if (damping > 0) {
        const decay = Math.exp(-damping * dt);
        vx *= decay;
        vy *= decay;
      }
      vy -= this.gravity * dt;
      x += vx * dt;
      y += vy * dt;
      const outOfBounds =
        x < options.environment.leftBound ||
        x > options.environment.rightBound ||
        y > options.environment.ceilingY ||
        y < options.environment.killY;
      points.push({ x, y, outOfBounds });
      if (outOfBounds) break;
      if (y <= 0 && vy < 0) break;
    }

    return points;
  }

  reset(): void {
    this.currentAngleDeg = clamp(
      this.launcher.defaultAngleDeg,
      this.launcher.minAngleDeg,
      this.launcher.maxAngleDeg,
    );
    this.currentPower =
      this.launcher.minPower + (this.launcher.maxPower - this.launcher.minPower) * 0.5;
  }
}
