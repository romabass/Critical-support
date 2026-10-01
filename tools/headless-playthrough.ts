/**
 * Автоматический прогон уровня без браузера.
 *
 * Скрипт создаёт полный игровой конвейер (GameSession + рендер-системы на
 * @napi-rs/canvas), стреляет по заранее заданным углам и печатает отчёт.
 * Используется как проверка баланса и как регрессионный тест уровня:
 * эталонный план должен приводить к победе.
 *
 * Запуск: npm run playthrough
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCanvas } from '@napi-rs/canvas';

import { AudioManager } from '../src/audio/AudioManager';
import { EventBus } from '../src/core/EventBus';
import type { GameEvents } from '../src/core/GameEvents';
import { GameSession } from '../src/gameplay/GameSession';
import { LevelManager } from '../src/levels/LevelManager';
import { CameraController } from '../src/render/CameraController';
import { defaultDebugView } from '../src/render/DebugOverlayOptions';
import { EffectSystem } from '../src/render/EffectSystem';
import { SceneRenderer, type SceneRenderInput } from '../src/render/SceneRenderer';

const FIXED_DT = 1 / 60;
const WIDTH = 1280;
const HEIGHT = 720;
const HERE = dirname(fileURLToPath(import.meta.url));

/** Эталонный план: два выстрела в верхние секции колонн. */
const REFERENCE_PLAN: readonly ShotPlan[] = [
  { angleDeg: 58, power: 0.56 },
  { angleDeg: 58, power: 0.56 },
];

interface ShotPlan {
  readonly angleDeg: number;
  readonly power: number;
}

interface RunReport {
  readonly levelId: string;
  readonly frames: number;
  readonly outcome: string;
  readonly won: boolean;
  readonly score: number;
  readonly rank: string;
  readonly shotsUsed: number;
  readonly maxShots: number;
  readonly destroyedGroupPercent: number;
  readonly protectedDamagePercent: readonly { objectId: string; damagePercent: number }[];
  readonly protectObjectiveProgress: number;
  readonly redZoneMass: number;
  readonly greenZoneMass: number;
  readonly durationSeconds: number;
  readonly failureReason: string | null;
  readonly objectives: {
    id: string;
    completed: boolean;
    violated: boolean;
    progress: number;
    value: string;
  }[];
}

const NO_DEBUG_DATA = {
  criticalSupports: [],
  contacts: [],
  objectiveLines: [],
  overlayLines: [],
  stats: [],
  generatorHealth: null,
  collapsedRatio: 0,
} as unknown as SceneRenderInput['debugData'];

function renderInput(session: GameSession, effects: EffectSystem): SceneRenderInput {
  const snapshot = session.projectiles.snapshot;
  return {
    elements: session.elements,
    graph: session.graph,
    zones: session.zones.statuses(),
    projectile: snapshot
      ? {
          x: snapshot.x,
          y: snapshot.y,
          radius: snapshot.data.radius,
          trail: session.projectiles.trailPoints,
        }
      : null,
    effects,
    analysis: session.analysis.report,
    analysisActive: session.analysis.isActive,
    launcher: {
      x: session.ballistics.origin.x,
      y: session.ballistics.origin.y,
      angleDeg: session.ballistics.angleDeg,
      power: session.ballistics.power,
      ready: !session.projectiles.active && session.shotsRemaining > 0,
    },
    environment: session.level.environment,
    debug: defaultDebugView(),
    debugData: NO_DEBUG_DATA,
    time: session.elapsedSeconds,
  };
}

async function main(): Promise<void> {
  const manager = new LevelManager();
  const level = await manager.load(process.argv[2] ?? manager.defaultLevelId);

  const events = new EventBus<GameEvents>();
  const camera = new CameraController(
    {
      centerX: level.camera?.centerX ?? level.launcher.x + 14,
      centerY: level.camera?.centerY ?? 8,
    },
    { width: WIDTH, height: HEIGHT },
  );
  const effects = new EffectSystem('medium');
  const session = new GameSession(level, events, new AudioManager(events), effects, camera, {
    settleDelay: 0.3,
  });

  const canvas = createCanvas(WIDTH, HEIGHT);
  const raw = canvas.getContext('2d');
  if (!raw) throw new Error('Не удалось создать 2D-контекст @napi-rs/canvas');
  // SKRSContext2D реализует тот же Drawing API, что и браузерный контекст,
  // но объявлен отдельным типом, поэтому используем структурное приведение.
  const ctx = raw as unknown as CanvasRenderingContext2D;
  const scene = new SceneRenderer(camera);

  const maxFrames = 60 * 40;
  let frames = 0;
  const step = (): void => {
    session.step(FIXED_DT);
    scene.render(ctx, renderInput(session, effects));
    frames += 1;
  };

  for (const shot of REFERENCE_PLAN) {
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

  // Мир должен успокоиться, чтобы итоговая оценка была корректной.
  let tail = 0;
  while (session.sessionOutcome === 'running' && frames < maxFrames && tail < 60 * 8) {
    step();
    tail += 1;
  }

  let result = session.result;
  if (!result) {
    // Страховка: если исход не выставился, прогоняем ещё немного и оцениваем принудительно.
    for (let f = 0; f < 60 * 5 && !result; f += 1) step();
    result = session.forceEvaluate();
  }
  if (!result) throw new Error('Сессия не сформировала результат');

  const statuses = session.refreshObjectives();
  const red = session.zones.statuses().find((z) => z.id === 'red_zone');
  const green = session.zones.statuses().find((z) => z.id === 'green_zone');
  const protect = statuses.find((o) => o.type === 'protect_object');
  const protectedIds = level.objectives
    .filter((o) => o.type === 'protect_object' && o.objectId)
    .map((o) => o.objectId as string);

  const report: RunReport = {
    levelId: level.id,
    frames,
    outcome: session.sessionOutcome,
    won: result.won,
    score: result.score,
    rank: result.rank,
    shotsUsed: result.shotsUsed,
    maxShots: level.maxShots,
    destroyedGroupPercent: Number(result.destroyedPercent.toFixed(2)),
    protectedDamagePercent: protectedIds.map((id) => ({
      objectId: id,
      damagePercent: Number(session.objectDamagePercent(id).toFixed(2)),
    })),
    protectObjectiveProgress: Number((protect?.progress ?? 1).toFixed(4)),
    redZoneMass: Number((red?.largeDebrisMass ?? 0).toFixed(2)),
    greenZoneMass: Number((green?.debrisMass ?? 0).toFixed(2)),
    durationSeconds: Number(result.durationSeconds.toFixed(2)),
    failureReason: result.failureReason,
    objectives: statuses.map((o) => ({
      id: o.id,
      completed: o.completed,
      violated: o.violated,
      progress: Number(o.progress.toFixed(3)),
      value: o.value,
    })),
  };

  const line = (label: string, value: string | number | boolean | null): string =>
    `${label.padEnd(28)} ${String(value)}`;

  console.log('── Автопрогон уровня ───────────────────────────────');
  console.log(line('уровень', report.levelId));
  console.log(line('кадров симуляции', report.frames));
  console.log(line('исход', report.outcome));
  console.log(line('победа', report.won));
  console.log(line('счёт', report.score));
  console.log(line('ранг', report.rank));
  console.log(line('выстрелов', `${report.shotsUsed}/${report.maxShots}`));
  console.log(line('разрушено верхней башни', `${report.destroyedGroupPercent}%`));
  for (const p of report.protectedDamagePercent) {
    console.log(line(`повреждение ${p.objectId}`, `${p.damagePercent}%`));
  }
  console.log(line('красная зона', `${report.redZoneMass} кг`));
  console.log(line('зелёная зона', `${report.greenZoneMass} кг`));
  console.log(line('длительность', `${report.durationSeconds} с`));
  console.log(line('причина поражения', report.failureReason ?? '—'));
  for (const o of report.objectives) {
    console.log(
      line(
        `цель ${o.id}`,
        `${o.completed ? 'выполнена' : 'не выполнена'}${o.violated ? ' (нарушена)' : ''}: ${o.value}`,
      ),
    );
  }

  const outDir = resolve(HERE, '../artifacts');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, 'playthrough.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  if (!report.won) {
    console.error('\nЭталонный план не привёл к победе — уровень нужно перебалансировать.');
    process.exitCode = 1;
  }
}

await main();
