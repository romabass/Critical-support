import type { StructuralConnection } from '../physics/StructuralConnection';
import type { StructuralElement } from '../physics/StructuralElement';
import type { ZoneController } from '../gameplay/ZoneController';
import type { ObjectiveSystem } from '../gameplay/ObjectiveSystem';
import type { ScoringSystem } from '../gameplay/ScoringSystem';
import type { AnalysisSystem } from '../gameplay/AnalysisSystem';
import type { BallisticsController } from '../physics/BallisticsController';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { ProjectileController } from '../physics/ProjectileController';
import type { StructuralGraph } from '../physics/StructuralGraph';
import type { LevelDefinition } from '../data/LevelData';
import type { EffectSystem } from './EffectSystem';
import { defaultDebugView, type DebugViewOptions } from './DebugOverlayOptions';
import { Palette } from './Palette';
import type { DebugRenderData } from './DebugRenderer';

export interface DebugFrameStats {
  readonly fps: number;
  readonly frameMs: number;
  readonly physicsSteps: number;
  readonly drawCalls: number;
}

export interface DebugContext {
  readonly graph: StructuralGraph;
  readonly zones: ZoneController;
  readonly objectives: ObjectiveSystem;
  readonly scoring: ScoringSystem;
  readonly analysis: AnalysisSystem;
  readonly ballistics: BallisticsController;
  readonly physics: PhysicsWorld;
  readonly projectiles: ProjectileController;
  readonly effects: EffectSystem;
  readonly level: LevelDefinition;
  readonly shotsUsed: number;
  readonly elapsedSeconds: number;
  readonly won: boolean | null;
}

/**
 * Отладочная панель: сбор метрик, сбор данных для визуализаций,
 * отрисовка панели и переключение слоёв по клавишам.
 */
export class DebugOverlay {
  private visible = false;
  private fps = 0;
  private frameMs = 0;
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private view: DebugViewOptions = defaultDebugView();
  private readonly contactPoints: { x: number; y: number }[] = [];

  constructor(private readonly width: number) {}

  get isVisible(): boolean {
    return this.visible;
  }

  get options(): DebugViewOptions {
    return this.view;
  }

  setVisible(visible: boolean): boolean {
    this.visible = visible;
    return this.visible;
  }

  toggle(): boolean {
    return this.setVisible(!this.visible);
  }

  /** Переключение отдельного слоя. */
  toggleLayer(layer: keyof Omit<DebugViewOptions, 'enabled'>): DebugViewOptions {
    this.view = { ...this.view, [layer]: !this.view[layer] };
    return this.view;
  }

  registerContact(x: number, y: number): void {
    this.contactPoints.push({ x, y });
    if (this.contactPoints.length > 64) this.contactPoints.shift();
  }

  update(dt: number, frameMs: number): void {
    this.frameMs = this.frameMs * 0.85 + frameMs * 0.15;
    this.fpsAccumulator += dt;
    this.fpsFrames++;
    if (this.fpsAccumulator >= 0.4) {
      this.fps = this.fpsFrames / this.fpsAccumulator;
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }
    while (this.contactPoints.length > 32) this.contactPoints.shift();
  }

  get stats(): DebugFrameStats {
    return {
      fps: Math.round(this.fps),
      frameMs: Number(this.frameMs.toFixed(2)),
      physicsSteps: this.physicsSteps,
      drawCalls: this.drawCalls,
    };
  }

  private physicsSteps = 0;
  private drawCalls = 0;

  recordFrame(physicsSteps: number, drawCalls: number): void {
    this.physicsSteps = physicsSteps;
    this.drawCalls = drawCalls;
  }

  /** Сбор геометрии для отладочных слоёв. */
  collectRenderData(ctx: DebugContext): DebugRenderData {
    const elements = ctx.graph.elements;
    const colliders = elements.map((el: StructuralElement) => {
      const ext = el.halfExtents;
      return {
        x: el.getPosition().x,
        y: el.getPosition().y,
        w: ext.width * 2,
        h: ext.height * 2,
        angle: el.getAngle(),
        circle: el.definition.shape === 'circle',
        destroyed: el.isDestroyed,
      };
    });

    const connections: DebugRenderData['connections'] = ctx.graph.connections.map(
      (connection: StructuralConnection) => {
        const a = ctx.graph.getElement(connection.aId);
        const b = ctx.graph.getElement(connection.bId);
        const pa = a?.getPosition() ?? { x: 0, y: 0 };
        const pb = b?.getPosition() ?? { x: 0, y: 0 };
        return {
          ax: pa.x,
          ay: pa.y,
          bx: pb.x,
          by: pb.y,
          broken: connection.isBroken,
          stress: connection.stressRatio,
        };
      },
    );

    const centersOfMass = elements.map((el) => ({
      x: el.getPosition().x,
      y: el.getPosition().y,
      mass: el.mass,
    }));

    const criticalSupports = elements
      .filter((el) => el.critical && el.loadBearing && !el.isDestroyed)
      .map((el) => ({
        x: el.getPosition().x,
        y: el.getPosition().y,
        label: el.label,
      }));

    const forceVectors = elements
      .filter((el) => !el.isDestroyed)
      .map((el) => {
        const v = el.getVelocity();
        return { x: el.getPosition().x, y: el.getPosition().y, fx: v.x, fy: v.y };
      });

    const actualTrajectory = [...(ctx.projectiles.trailPoints ?? [])];

    const zones = ctx.zones.definitions.map((z) => ({
      x: z.x,
      y: z.y,
      width: z.width,
      height: z.height,
      kind: z.kind,
    }));

    return {
      colliders,
      connections,
      centersOfMass,
      criticalSupports,
      contactPoints: this.contactPoints,
      forceVectors,
      actualTrajectory,
      zones,
    };
  }

  /** Текстовые строки панели. */
  buildLines(ctx: DebugContext): string[] {
    const graph = ctx.graph.snapshot();
    const projectile = ctx.projectiles.snapshot;
    const destroyed = ctx.graph.elements.filter((el) => el.isDestroyed).length;
    const generator = ctx.graph.elements.find((el) => el.protectable);
    const redZone = ctx.zones.redZones[0];
    const greenZone = ctx.zones.greenZones[0];
    const analysis = ctx.analysis.report;

    const lines: string[] = [
      `FPS ${Math.round(this.fps)}  кадр ${this.frameMs.toFixed(2)}ms  шаги ${this.physicsSteps}  draw ${this.drawCalls}`,
      `Тела: ${graph.totalElements}  связи: ${graph.activeConnections}/${graph.totalConnections}  разрушено: ${destroyed}`,
      `Граф: пересчётов ${graph.computeCount}  отсоединено ${graph.detachedCount}  опор ${graph.anchoredCount}  ${graph.lastComputeMs.toFixed(2)}ms`,
      `Запуски: ${ctx.shotsUsed}/${ctx.level.maxShots}  время: ${ctx.elapsedSeconds.toFixed(1)}с  итог: ${ctx.won === null ? '—' : ctx.won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'}`,
      `Угол: ${ctx.ballistics.angleDeg.toFixed(1)}°  сила: ${(ctx.ballistics.power * 100).toFixed(0)}%  скорость: ${ctx.ballistics.speedFromPower(ctx.ballistics.power).toFixed(1)} м/с`,
    ];

    if (projectile) {
      lines.push(
        `Снаряд: (${projectile.x.toFixed(2)}, ${projectile.y.toFixed(2)})  v=${projectile.speed.toFixed(2)}  отскоки ${ctx.projectiles.bounceCount}/${projectile.data.maxBounces}`,
      );
    } else {
      lines.push('Снаряд: нет в полёте');
    }

    if (generator) {
      lines.push(
        `Генератор ${generator.id}: HP ${generator.health.toFixed(0)}/${generator.maxHealth} (${generator.damagePercent.toFixed(1)}%)  ${generator.getPosition().x.toFixed(1)},${generator.getPosition().y.toFixed(1)}`,
      );
    }

    lines.push(
      `Зоны: красная ${redZone ? redZone.largeDebrisMass.toFixed(0) : '—'}кг  зелёная ${greenZone ? greenZone.debrisMass.toFixed(0) : '—'}кг  попаданий ${ctx.zones.redProjectileHits()}`,
    );

    const statuses = ctx.objectives.statuses();
    for (const status of statuses) {
      const mark = status.violated ? '✕' : status.completed ? '✓' : '…';
      lines.push(`  ${mark} ${status.label}: ${status.value}`);
    }

    if (analysis) {
      lines.push(`Анализ: ${analysis.summary} риск ${(analysis.collapseRisk * 100).toFixed(0)}%`);
    }

    lines.push(
      `Частицы: ${ctx.effects.particleCount}  трещины: ${ctx.effects.crackCount}  кольца: ${ctx.effects.ringCount}`,
    );
    lines.push(
      `Слои: коллайдеры ${yN(this.view.colliders)} связи ${yN(this.view.connections)} ЦМ ${yN(this.view.centersOfMass)} ` +
        `опоры ${yN(this.view.criticalSupports)} зоны ${yN(this.view.zones)} траектория ${yN(this.view.actualTrajectory)} ` +
        `контакты ${yN(this.view.contactPoints)} силы ${yN(this.view.forceVectors)}`,
    );

    return lines;
  }

  /** Отрисовка панели. */
  draw(ctx: CanvasRenderingContext2D, lines: readonly string[]): void {
    if (!this.visible) return;
    const pad = 8;
    const lineHeight = 14;
    ctx.save();
    ctx.font = '11px "IBM Plex Mono", monospace';
    let maxWidth = 0;
    for (const line of lines) maxWidth = Math.max(maxWidth, ctx.measureText(line).width);

    const boxWidth = Math.min(this.width - 16, maxWidth + pad * 2);
    const boxHeight = lines.length * lineHeight + pad * 2;
    ctx.fillStyle = 'rgba(13,17,22,0.88)';
    ctx.strokeStyle = 'rgba(125,139,152,0.5)';
    ctx.lineWidth = 1;
    ctx.fillRect(8, 8, boxWidth, boxHeight);
    ctx.strokeRect(8.5, 8.5, boxWidth - 1, boxHeight - 1);

    ctx.fillStyle = Palette.textPrimary;
    lines.forEach((line, i) => {
      ctx.fillStyle = line.startsWith('  ') ? Palette.textSecondary : Palette.textPrimary;
      ctx.fillText(line, 8 + pad, 8 + pad + lineHeight * (i + 0.75));
    });
    ctx.restore();
  }
}

function yN(value: boolean): string {
  return value ? 'вкл' : 'выкл';
}
