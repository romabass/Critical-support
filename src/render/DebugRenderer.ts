import type { CameraController } from './CameraController';
import type { DebugViewOptions } from './DebugOverlayOptions';
import { Palette } from './Palette';

export interface DebugRenderData {
  readonly colliders: readonly {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly angle: number;
    readonly circle: boolean;
    readonly destroyed: boolean;
  }[];
  readonly connections: readonly {
    readonly ax: number;
    readonly ay: number;
    readonly bx: number;
    readonly by: number;
    readonly broken: boolean;
    readonly stress: number;
  }[];
  readonly centersOfMass: readonly {
    readonly x: number;
    readonly y: number;
    readonly mass: number;
  }[];
  readonly criticalSupports: readonly {
    readonly x: number;
    readonly y: number;
    readonly label: string;
  }[];
  readonly contactPoints: readonly { readonly x: number; y: number }[];
  readonly forceVectors: readonly {
    readonly x: number;
    readonly y: number;
    readonly fx: number;
    readonly fy: number;
  }[];
  readonly actualTrajectory: readonly { readonly x: number; readonly y: number }[];
  readonly zones: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly kind: string;
  }[];
}

/** Отрисовка отладочных слоёв: коллайдеры, связи, центры масс, векторы. */
export function drawDebugLayer(
  ctx: CanvasRenderingContext2D,
  camera: CameraController,
  options: DebugViewOptions,
  data: DebugRenderData,
): void {
  ctx.save();
  ctx.lineWidth = 1;

  if (options.zones) {
    for (const zone of data.zones) {
      const topLeft = camera.worldToScreen(zone.x, zone.y + zone.height);
      const ppm = camera.pixelsPerMeter();
      ctx.strokeStyle = zone.kind === 'red' ? 'rgba(208,64,47,0.85)' : 'rgba(63,174,98,0.85)';
      ctx.strokeRect(topLeft.x, topLeft.y, zone.width * ppm, zone.height * ppm);
    }
  }

  if (options.colliders) {
    const ppm = camera.pixelsPerMeter();
    for (const box of data.colliders) {
      const screen = camera.worldToScreen(box.x, box.y);
      ctx.save();
      ctx.translate(screen.x, screen.y);
      ctx.rotate(-box.angle);
      ctx.strokeStyle = box.destroyed ? 'rgba(208,64,47,0.55)' : 'rgba(63,127,208,0.85)';
      ctx.setLineDash(box.destroyed ? [3, 3] : []);
      if (box.circle) {
        ctx.beginPath();
        ctx.arc(0, 0, (box.w / 2) * ppm, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect((-box.w / 2) * ppm, (-box.h / 2) * ppm, box.w * ppm, box.h * ppm);
      }
      ctx.restore();
    }
  }

  if (options.connections) {
    for (const connection of data.connections) {
      const a = camera.worldToScreen(connection.ax, connection.ay);
      const b = camera.worldToScreen(connection.bx, connection.by);
      ctx.strokeStyle = connection.broken
        ? 'rgba(208,64,47,0.55)'
        : connection.stress > 0.7
          ? Palette.orange
          : 'rgba(63,127,208,0.5)';
      ctx.lineWidth = connection.stress > 0.7 ? 2.5 : 1.4;
      ctx.beginPath();
      if (connection.broken) {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.moveTo(mx - 5, my - 5);
        ctx.lineTo(mx + 5, my + 5);
        ctx.moveTo(mx + 5, my - 5);
        ctx.lineTo(mx - 5, my + 5);
      } else {
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
    }
  }

  if (options.centersOfMass) {
    for (const com of data.centersOfMass) {
      const screen = camera.worldToScreen(com.x, com.y);
      ctx.fillStyle = Palette.yellow;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = Palette.textMuted;
      ctx.font = '9px "IBM Plex Mono", monospace';
      ctx.fillText(`${com.mass.toFixed(0)}кг`, screen.x + 9, screen.y - 3);
    }
  }

  if (options.criticalSupports) {
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    for (const support of data.criticalSupports) {
      const screen = camera.worldToScreen(support.x, support.y);
      ctx.strokeStyle = Palette.orange;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = Palette.orange;
      ctx.fillText(support.label, screen.x + 14, screen.y + 3);
    }
  }

  if (options.actualTrajectory) {
    const points = data.actualTrajectory;
    if (points.length > 1) {
      ctx.strokeStyle = Palette.blue;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const first = camera.worldToScreen(points[0].x, points[0].y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < points.length; i++) {
        const p = camera.worldToScreen(points[i].x, points[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  if (options.contactPoints) {
    for (const contact of data.contactPoints) {
      const screen = camera.worldToScreen(contact.x, contact.y);
      ctx.fillStyle = Palette.red;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (options.forceVectors) {
    for (const vector of data.forceVectors) {
      const screen = camera.worldToScreen(vector.x, vector.y);
      const ppm = camera.pixelsPerMeter();
      ctx.strokeStyle = Palette.green;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(screen.x, screen.y);
      ctx.lineTo(screen.x + vector.fx * ppm, screen.y - vector.fy * ppm);
      ctx.stroke();
      ctx.fillStyle = Palette.green;
      ctx.beginPath();
      const tipX = screen.x + vector.fx * ppm;
      const tipY = screen.y - vector.fy * ppm;
      ctx.arc(tipX, tipY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}
