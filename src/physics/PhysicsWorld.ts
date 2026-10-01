import type { Body } from 'planck';
import { Vec2, World } from 'planck';

import type { EnvironmentDefinition } from '../data/LevelData';

export interface PhysicsWorldOptions {
  readonly environment: EnvironmentDefinition;
  /** Шаг симуляции в секундах. */
  readonly timeStep?: number;
  readonly velocityIterations?: number;
  readonly positionIterations?: number;
}

/** Обёртка над planck.World: единая точка шага симуляции и доступа к контактам. */
export class PhysicsWorld {
  readonly world: World;
  readonly timeStep: number;
  private readonly velocityIterations: number;
  private readonly positionIterations: number;
  private accumulator = 0;
  /** Счётчик шагов — используется для временных меток событий. */
  private stepCount = 0;
  private readonly maxSubSteps = 6;

  constructor(options: PhysicsWorldOptions) {
    this.timeStep = options.timeStep ?? 1 / 60;
    this.velocityIterations = options.velocityIterations ?? 8;
    this.positionIterations = options.positionIterations ?? 3;
    this.world = new World({
      gravity: Vec2(0, -options.environment.gravity),
      allowSleep: true,
    });
  }

  get currentTime(): number {
    return this.stepCount * this.timeStep;
  }

  get steps(): number {
    return this.stepCount;
  }

  /**
   * Продвигает физику фиксированным шагом с ограничением числа подшагов.
   * Возвращает количество выполненных шагов.
   */
  step(dt: number): number {
    this.accumulator += Math.min(dt, this.timeStep * this.maxSubSteps);
    let steps = 0;
    while (this.accumulator >= this.timeStep && steps < this.maxSubSteps) {
      this.world.step(this.timeStep, this.velocityIterations, this.positionIterations);
      this.accumulator -= this.timeStep;
      this.stepCount++;
      steps++;
    }
    if (steps >= this.maxSubSteps) this.accumulator = 0;
    return steps;
  }

  destroyBody(body: Body): void {
    this.world.destroyBody(body);
  }

  clear(): void {
    for (let body = this.world.getBodyList(); body; body = body.getNext()) {
      this.world.destroyBody(body);
    }
    this.stepCount = 0;
    this.accumulator = 0;
  }
}
