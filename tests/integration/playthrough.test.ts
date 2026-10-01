import { describe, expect, it } from 'vitest';

import { AudioManager } from '../../src/audio/AudioManager';
import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/GameEvents';
import { GameSession } from '../../src/gameplay/GameSession';
import { LevelManager } from '../../src/levels/LevelManager';
import { CameraController } from '../../src/render/CameraController';
import { EffectSystem } from '../../src/render/EffectSystem';
import type { LevelDefinition } from '../../src/data/LevelData';

const FIXED_DT = 1 / 60;
const REFERENCE_PLAN = [
  { angleDeg: 58, power: 0.56 },
  { angleDeg: 58, power: 0.56 },
] as const;

interface RunOutcome {
  won: boolean;
  score: number;
  shotsUsed: number;
  destroyedPercent: number;
  generatorDamage: number;
  redZoneMass: number;
  objectives: { id: string; completed: boolean; violated: boolean }[];
  frames: number;
}

function runPlan(
  level: LevelDefinition,
  plan: readonly { angleDeg: number; power: number }[],
  options: { settleDelay?: number } = {},
): RunOutcome {
  const events = new EventBus<GameEvents>();
  const camera = new CameraController(
    { centerX: level.camera?.centerX ?? 14, centerY: level.camera?.centerY ?? 8 },
    { width: 1280, height: 720 },
  );
  const session = new GameSession(
    level,
    events,
    new AudioManager(events),
    new EffectSystem('low'),
    camera,
    { settleDelay: options.settleDelay ?? 0.3 },
  );

  const maxFrames = 60 * 40;
  let frames = 0;
  const step = (): void => {
    session.step(FIXED_DT);
    frames += 1;
  };

  try {
    for (const shot of plan) {
      if (session.sessionOutcome !== 'running' || session.shotsRemaining <= 0) break;
      session.unlockAim();
      session.setAim(shot.angleDeg, shot.power);
      if (!session.fire()) break;
      let idle = 0;
      while (session.sessionOutcome === 'running' && frames < maxFrames && idle < 60 * 9) {
        step();
        idle += 1;
      }
    }

    let tail = 0;
    while (session.sessionOutcome === 'running' && frames < maxFrames && tail < 60 * 8) {
      step();
      tail += 1;
    }

    let result = session.result;
    if (!result) {
      // Сессия ждёт следующего действия игрока: расходуем остаток запусков,
      // чтобы исход был определён штатным путём, а не через форсирование.
      while (!result && session.sessionOutcome === 'running' && session.shotsRemaining > 0) {
        session.unlockAim();
        session.setAim(5, 0.1);
        if (!session.fire()) break;
        for (let f = 0; f < 60 * 9 && session.sessionOutcome === 'running'; f += 1) step();
        result = session.result;
      }
    }
    if (!result) throw new Error('Сессия не сформировала результат');

    const statuses = session.refreshObjectives();
    return {
      won: result.won,
      score: result.score,
      shotsUsed: result.shotsUsed,
      destroyedPercent: result.destroyedPercent,
      generatorDamage: session.objectDamagePercent('generator_01'),
      redZoneMass: session.zones.statuses().find((z) => z.id === 'red_zone')?.largeDebrisMass ?? 0,
      objectives: statuses.map((o) => ({
        id: o.id,
        completed: o.completed,
        violated: o.violated,
      })),
      frames,
    };
  } finally {
    session.destroy();
  }
}

describe('эталонный прогон water_tower_01', () => {
  it('детерминированно приводит к победе', async () => {
    const level = await new LevelManager().load();
    const first = runPlan(level, REFERENCE_PLAN);
    const second = runPlan(level, REFERENCE_PLAN);

    expect(first.won).toBe(true);
    expect(first.objectives.every((o) => !o.violated)).toBe(true);
    expect(first.destroyedPercent).toBeGreaterThanOrEqual(80);
    expect(first.generatorDamage).toBeLessThanOrEqual(25);
    expect(first.redZoneMass).toBeLessThanOrEqual(320);
    expect(first.shotsUsed).toBeLessThanOrEqual(level.maxShots);

    // Симуляция обязана быть воспроизводимой: кадры, счёт и урон совпадают.
    expect(second).toEqual(first);
  });

  it('пустой выстрел в землю не проходит уровень', async () => {
    const level = await new LevelManager().load();
    const outcome = runPlan(level, [{ angleDeg: 5, power: 0.1 }]);
    expect(outcome.won).toBe(false);
  });
});
