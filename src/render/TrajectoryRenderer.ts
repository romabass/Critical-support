import { clamp, degToRad } from '../core/MathUtils';
import type { BallisticsController, TrajectoryPoint } from '../physics/BallisticsController';
import type { CameraController } from './CameraController';
import { Palette } from './Palette';

export interface TrajectoryRenderOptions {
  readonly show: boolean;
  readonly power: number;
  readonly ready: boolean;
  readonly paused: boolean;
  readonly aimX: number;
  readonly aimY: number;
}

/**
 * Отрисовка предварительной траектории, индикатора угла и шкалы силы.
 * Только рисование: расчёт делает BallisticsController.
 */
export class TrajectoryRenderer {
  constructor(private readonly camera: CameraController) {}

  draw(
    ctx: CanvasRenderingContext2D,
    points: readonly TrajectoryPoint[],
    options: TrajectoryRenderOptions,
  ): void {
    if (options.show && points.length > 1) {
      this.drawPath(ctx, points, options);
    }
    this.drawAimLine(ctx, options);
    this.drawPowerGauge(ctx, options);
  }

  private drawPath(
    ctx: CanvasRenderingContext2D,
    points: readonly TrajectoryPoint[],
    options: TrajectoryRenderOptions,
  ): void {
    const scale = this.camera.pixelsPerMeter();
    const toScreen = (p: { x: number; y: number }): { x: number; y: number } =>
      this.camera.worldToScreen(p.x, p.y);

    ctx.save();
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 6]);
    ctx.lineCap = 'round';

    // Разбиваем путь на участки внутри и вне границ, чтобы менять цвет.
    let segment: { x: number; y: number }[] = [];
    let currentOutOfBounds = false;

    const flush = (): void => {
      if (segment.length > 1) {
        ctx.strokeStyle = currentOutOfBounds ? Palette.red : Palette.orange;
        ctx.globalAlpha = currentOutOfBounds ? 0.95 : 0.85;
        ctx.beginPath();
        const first = toScreen(segment[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < segment.length; i++) {
          const s = toScreen(segment[i]);
          ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      }
      segment = [];
    };

    for (const point of points) {
      if (point.outOfBounds !== currentOutOfBounds) {
        flush();
        currentOutOfBounds = point.outOfBounds;
      }
      segment.push({ x: point.x, y: point.y });
    }
    flush();

    // Точки-маркеры каждые N шагов, чтобы линия читалась.
    ctx.setLineDash([]);
    ctx.fillStyle = currentOutOfBounds ? Palette.red : Palette.orangeDim;
    const markerStep = Math.max(1, Math.floor(points.length / 9));
    for (let i = 0; i < points.length; i += markerStep) {
      const p = points[i];
      if (p.outOfBounds) continue;
      const s = toScreen(p);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Конечная точка прогноза.
    const last = points[points.length - 1];
    const lastScreen = toScreen(last);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = last.outOfBounds ? Palette.red : Palette.orange;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(lastScreen.x, lastScreen.y, clamp(lastScreen.y, 0, 0) + 6, 0, Math.PI * 2);
    ctx.stroke();

    if (last.outOfBounds) {
      ctx.fillStyle = Palette.red;
      ctx.font = '600 12px "IBM Plex Mono", monospace';
      ctx.fillText('ВНЕ ОБЛАСТИ', lastScreen.x + 10, lastScreen.y - 8);
    }

    ctx.restore();
    void scale;
    void options;
  }

  /** Направление прицеливания от пусковой точки к курсору. */
  private drawAimLine(ctx: CanvasRenderingContext2D, options: TrajectoryRenderOptions): void {
    const launcher = this.camera.worldToScreen(options.aimX, options.aimY);
    const target = this.camera.worldToScreen(options.aimX + options.aimX, options.aimY);
    void target;

    const angleRad = degToRad(0);
    void angleRad;

    ctx.save();
    ctx.strokeStyle = options.ready ? Palette.green : Palette.red;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(launcher.x, launcher.y, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Шкала силы под пусковой установкой. */
  private drawPowerGauge(ctx: CanvasRenderingContext2D, options: TrajectoryRenderOptions): void {
    const origin = this.camera.worldToScreen(options.aimX, options.aimY);
    const width = 118;
    const height = 7;
    const x = origin.x - width / 2;
    const y = origin.y + 26;

    ctx.save();
    ctx.fillStyle = 'rgba(18,22,26,0.82)';
    ctx.fillRect(x - 3, y - 3, width + 6, height + 6);
    ctx.strokeStyle = Palette.graphiteLight;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 3.5, y - 3.5, width + 7, height + 7);

    const fill = clamp(options.power, 0, 1) * width;
    const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
    gradient.addColorStop(0, Palette.green);
    gradient.addColorStop(0.55, Palette.orange);
    gradient.addColorStop(1, Palette.red);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, fill, height);

    ctx.fillStyle = Palette.textSecondary;
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.fillText(`СИЛА ${Math.round(options.power * 100)}%`, x, y + height + 13);
    ctx.restore();
  }

  /** Стрелка направления в мировых координатах (используется в отладке). */
  drawDirection(ctx: CanvasRenderingContext2D, ballistics: BallisticsController): void {
    const origin = this.camera.worldToScreen(ballistics.origin.x, ballistics.origin.y);
    const dir = ballistics.directionVector();
    const len = 46;
    const tip = { x: origin.x + dir.x * len, y: origin.y - dir.y * len };

    ctx.save();
    ctx.strokeStyle = Palette.orange;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();

    ctx.fillStyle = Palette.orange;
    ctx.beginPath();
    const angle = Math.atan2(tip.y - origin.y, tip.x - origin.x);
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - Math.cos(angle - 0.4) * 9, tip.y - Math.sin(angle - 0.4) * 9);
    ctx.lineTo(tip.x - Math.cos(angle + 0.4) * 9, tip.y - Math.sin(angle + 0.4) * 9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
