import { clamp } from '../core/MathUtils';
import type { AnalysisReport } from '../gameplay/AnalysisSystem';
import type { ZoneStatus } from '../gameplay/ZoneController';
import type { CameraController } from './CameraController';
import type { EffectSystem } from './EffectSystem';
import type { CrackMark, Particle } from './EffectSystem';
import type { StructuralElement } from '../physics/StructuralElement';
import type { StructuralGraph } from '../physics/StructuralGraph';
import { Palette } from './Palette';
import type { DebugViewOptions } from './DebugOverlayOptions';
import { drawDebugLayer, type DebugRenderData } from './DebugRenderer';

export interface SceneRenderInput {
  readonly elements: readonly StructuralElement[];
  readonly graph: StructuralGraph;
  readonly zones: readonly ZoneStatus[];
  readonly projectile: {
    readonly x: number;
    readonly y: number;
    readonly radius: number;
    readonly trail: readonly { x: number; y: number }[];
  } | null;
  readonly effects: EffectSystem;
  readonly analysis: AnalysisReport | null;
  readonly analysisActive: boolean;
  readonly launcher: { x: number; y: number; angleDeg: number; power: number; ready: boolean };
  readonly environment: {
    readonly groundY: number;
    readonly leftBound: number;
    readonly rightBound: number;
    readonly killY: number;
    readonly ceilingY: number;
  };
  readonly debug: DebugViewOptions;
  readonly debugData: DebugRenderData;
  readonly time: number;
}

/** Рендерер игровой сцены: конструкция, зоны, снаряд, эффекты, отладка. */
export class SceneRenderer {
  constructor(private readonly camera: CameraController) {}

  render(ctx: CanvasRenderingContext2D, input: SceneRenderInput): void {
    this.drawBackground(ctx, input);
    this.drawZones(ctx, input.zones);
    this.drawElements(ctx, input);
    if (input.analysisActive && input.analysis) this.drawAnalysis(ctx, input);
    this.drawProjectile(ctx, input.projectile);
    this.drawEffects(ctx, input.effects);
    if (input.debug.enabled) {
      drawDebugLayer(ctx, this.camera, input.debug, input.debugData);
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D, input: SceneRenderInput): void {
    const rect = this.camera.visibleWorldRect;
    const topLeft = this.camera.worldToScreen(rect.left, rect.top);
    const bottomRight = this.camera.worldToScreen(rect.right, rect.bottom);

    const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gradient.addColorStop(0, '#0d1116');
    gradient.addColorStop(0.55, '#161c22');
    gradient.addColorStop(1, '#1e252c');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Техническая сетка.
    const ppm = this.camera.pixelsPerMeter();
    const gridStep = ppm > 42 ? 1 : ppm > 18 ? 2 : 5;
    ctx.strokeStyle = 'rgba(125,139,152,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(rect.left / gridStep) * gridStep; x <= rect.right; x += gridStep) {
      const s = this.camera.worldToScreen(x, rect.top);
      ctx.moveTo(Math.round(s.x) + 0.5, topLeft.y);
      ctx.lineTo(Math.round(s.x) + 0.5, ctx.canvas.height);
    }
    for (let y = Math.ceil(rect.bottom / gridStep) * gridStep; y <= rect.top; y += gridStep) {
      const s = this.camera.worldToScreen(rect.left, y);
      ctx.moveTo(0, Math.round(s.y) + 0.5);
      ctx.lineTo(ctx.canvas.width, Math.round(s.y) + 0.5);
    }
    ctx.stroke();

    void bottomRight;
    this.drawGroundLine(ctx, input);
  }

  private drawGroundLine(ctx: CanvasRenderingContext2D, input: SceneRenderInput): void {
    const left = this.camera.worldToScreen(input.environment.leftBound, input.environment.groundY);
    const right = this.camera.worldToScreen(
      input.environment.rightBound,
      input.environment.groundY,
    );
    ctx.save();
    ctx.strokeStyle = Palette.steel;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(125,139,152,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([9, 7]);
    const kill = this.camera.worldToScreen(input.environment.leftBound, input.environment.killY);
    const killRight = this.camera.worldToScreen(
      input.environment.rightBound,
      input.environment.killY,
    );
    ctx.beginPath();
    ctx.moveTo(kill.x, kill.y);
    ctx.lineTo(killRight.x, killRight.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawZones(ctx: CanvasRenderingContext2D, zones: readonly ZoneStatus[]): void {
    ctx.save();
    for (const zone of zones) {
      const topLeft = this.camera.worldToScreen(zone.rect.x, zone.rect.y + zone.rect.height);
      const w = zone.rect.width * this.camera.pixelsPerMeter();
      const h = zone.rect.height * this.camera.pixelsPerMeter();

      ctx.globalAlpha = 0.09 + clamp(zone.fillRatio, 0, 1) * 0.14;
      ctx.fillStyle = zone.kind === 'red' ? Palette.red : Palette.green;
      ctx.fillRect(topLeft.x, topLeft.y, w, h);

      ctx.globalAlpha = 0.72;
      ctx.strokeStyle = zone.kind === 'red' ? Palette.red : Palette.green;
      ctx.lineWidth = zone.kind === 'red' ? 2 : 1.6;
      if (zone.kind === 'red') ctx.setLineDash([10, 6]);
      ctx.strokeRect(topLeft.x, topLeft.y, w, h);
      ctx.setLineDash([]);

      ctx.globalAlpha = 0.95;
      ctx.fillStyle = zone.kind === 'red' ? Palette.red : Palette.green;
      ctx.font = '700 11px "IBM Plex Mono", monospace';
      ctx.fillText(zone.label.toUpperCase(), topLeft.x + 6, topLeft.y + 15);
      ctx.globalAlpha = 0.7;
      ctx.font = '600 10px "IBM Plex Mono", monospace';
      const limitText =
        zone.kind === 'red' && zone.limit !== null
          ? `${Math.round(zone.largeDebrisMass)} / ${zone.limit} кг`
          : `${Math.round(zone.debrisMass)} кг · ${zone.debrisCount} обл.`;
      ctx.fillText(limitText, topLeft.x + 6, topLeft.y + 29);
    }
    ctx.restore();
  }

  private drawElements(ctx: CanvasRenderingContext2D, input: SceneRenderInput): void {
    const ppm = this.camera.pixelsPerMeter();
    const detached = input.graph.detachedIds;

    for (const element of input.elements) {
      const pos = element.getPosition();
      const screen = this.camera.worldToScreen(pos.x, pos.y);
      const angle = element.angleDeg();
      const detachedNow = detached.includes(element.id);

      ctx.save();
      ctx.translate(screen.x, screen.y);
      ctx.rotate(-angle);

      if (element.isDestroyed) {
        ctx.restore();
        this.drawWreck(ctx, element, ppm);
        continue;
      }

      const ext = element.halfExtents;
      const w = ext.width * 2 * ppm;
      const h = ext.height * 2 * ppm;
      const damageTint = this.damageTint(element);

      if (element.definition.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, ext.width * ppm, 0, Math.PI * 2);
        ctx.fillStyle = element.material.baseColor;
        ctx.fill();
        ctx.strokeStyle = damageTint;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillStyle = element.material.baseColor;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeStyle = damageTint;
        ctx.lineWidth = Math.max(1.5, Math.min(3, ppm * 0.06));
        ctx.strokeRect(-w / 2, -h / 2, w, h);

        this.drawMaterialPattern(ctx, element, w, h, ppm);
      }

      // Трещины.
      if (element.crackLevel > 0.05) {
        this.drawCracks(ctx, element, w, h);
      }

      // Контур «здоровой/повреждённой» конструкции.
      if (element.healthRatio < 0.85 && !element.isDestroyed) {
        ctx.strokeStyle = Palette.redDim;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4);
        ctx.setLineDash([]);
      }

      if (detachedNow) {
        ctx.strokeStyle = Palette.yellow;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(-w / 2 - 3.5, -h / 2 - 3.5, w + 7, h + 7);
        ctx.setLineDash([]);
      }

      ctx.restore();
    }
  }

  private drawMaterialPattern(
    ctx: CanvasRenderingContext2D,
    element: StructuralElement,
    w: number,
    h: number,
    ppm: number,
  ): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2, w, h);
    ctx.clip();
    ctx.globalAlpha = 0.22;

    switch (element.material.visualStyle) {
      case 'steel': {
        ctx.strokeStyle = Palette.steelBright;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-w / 2, 0);
        ctx.lineTo(w / 2, 0);
        ctx.stroke();
        break;
      }
      case 'wood': {
        ctx.strokeStyle = Palette.woodDark;
        ctx.lineWidth = 1;
        for (let i = -h / 2; i < h / 2; i += Math.max(3, h / 4)) {
          ctx.beginPath();
          ctx.moveTo(-w / 2, i);
          ctx.lineTo(w / 2, i + 2);
          ctx.stroke();
        }
        break;
      }
      case 'glass': {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-w / 4, -h / 2);
        ctx.lineTo(-w / 6, h / 2);
        ctx.stroke();
        break;
      }
      case 'machine': {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = Palette.generatorDamaged;
        const barW = Math.max(2, w * 0.12);
        for (let i = -w / 2 + 3; i < w / 2 - barW; i += barW * 2.1) {
          ctx.fillRect(i, -h / 2, barW, h);
        }
        break;
      }
      case 'concrete':
      default: {
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = '#ffffff';
        const dot = Math.max(1, ppm * 0.02);
        for (let x = -w / 2; x < w / 2; x += dot * 6) {
          for (let y = -h / 2; y < h / 2; y += dot * 6) {
            ctx.fillRect(x, y, dot, dot);
          }
        }
        break;
      }
    }
    ctx.restore();
  }

  private drawCracks(
    ctx: CanvasRenderingContext2D,
    element: StructuralElement,
    w: number,
    h: number,
  ): void {
    const count = Math.ceil(element.crackLevel * 5);
    ctx.save();
    ctx.strokeStyle = 'rgba(20,24,28,0.72)';
    ctx.lineWidth = Math.max(1, Math.min(2, w * 0.012));
    const rand = (i: number): number => ((i * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < count; i++) {
      const x0 = (rand(i * 3) - 0.5) * w * 0.8;
      const y0 = (rand(i * 3 + 1) - 0.5) * h * 0.8;
      const len = (0.2 + rand(i * 3 + 2) * 0.5) * Math.min(w, h) * 2.2;
      const dir = rand(i * 7) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + Math.cos(dir) * len, y0 + Math.sin(dir) * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Остатки разрушенного элемента: тусклый силуэт на месте падения. */
  private drawWreck(ctx: CanvasRenderingContext2D, element: StructuralElement, ppm: number): void {
    const pos = element.getPosition();
    const screen = this.camera.worldToScreen(pos.x, pos.y);
    if (screen.y < -80 || screen.y > ctx.canvas.height + 80) return;
    const ext = element.halfExtents;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(-element.angleDeg());
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = element.material.baseColor;
    const w = ext.width * 2 * ppm;
    const h = ext.height * 2 * ppm;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }

  private damageTint(element: StructuralElement): string {
    const ratio = 1 - element.healthRatio;
    if (ratio < 0.25) return element.material.edgeColor;
    const t = clamp(ratio / 0.75, 0, 1);
    return t < 0.55 ? element.material.edgeColor : Palette.redDim;
  }

  private drawAnalysis(ctx: CanvasRenderingContext2D, input: SceneRenderInput): void {
    const report = input.analysis;
    if (!report) return;
    ctx.save();
    for (const highlight of report.highlights) {
      const element = input.graph.getElement(highlight.elementId);
      if (!element || element.isDestroyed) continue;
      const screen = this.camera.worldToScreen(element.getPosition().x, element.getPosition().y);
      const ext = element.halfExtents;
      const ppm = this.camera.pixelsPerMeter();
      const color = this.analysisColor(highlight.role);
      if (!color) continue;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.85;
      ctx.strokeRect(
        screen.x - ext.width * ppm - 3,
        screen.y - ext.height * ppm - 3,
        ext.width * 2 * ppm + 6,
        ext.height * 2 * ppm + 6,
      );

      if (highlight.stress > 0.5) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.16;
        ctx.fillRect(
          screen.x - ext.width * ppm - 3,
          screen.y - ext.height * ppm - 3,
          (ext.width * 2 * ppm + 6) * clamp(highlight.stress, 0, 1),
          ext.height * 2 * ppm + 6,
        );
      }
    }
    ctx.restore();
  }

  private analysisColor(role: string): string | null {
    switch (role) {
      case 'critical_support':
        return Palette.orange;
      case 'protectable':
        return Palette.green;
      case 'detached':
        return Palette.yellow;
      case 'damaged':
        return Palette.red;
      case 'stable':
        return Palette.blue;
      default:
        return null;
    }
  }

  private drawProjectile(
    ctx: CanvasRenderingContext2D,
    projectile: SceneRenderInput['projectile'],
  ): void {
    if (!projectile) return;
    const ppm = this.camera.pixelsPerMeter();

    if (projectile.trail.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 1; i < projectile.trail.length; i++) {
        const a = this.camera.worldToScreen(projectile.trail[i - 1].x, projectile.trail[i - 1].y);
        const b = this.camera.worldToScreen(projectile.trail[i].x, projectile.trail[i].y);
        ctx.strokeStyle = `rgba(232,130,58,${(i / projectile.trail.length) * 0.5})`;
        ctx.lineWidth = (projectile.radius * ppm * 2 * i) / projectile.trail.length;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    const screen = this.camera.worldToScreen(projectile.x, projectile.y);
    const r = projectile.radius * ppm;
    ctx.save();
    ctx.translate(screen.x, screen.y);
    const gradient = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
    gradient.addColorStop(0, '#d8dee3');
    gradient.addColorStop(0.55, '#98a3ad');
    gradient.addColorStop(1, '#5c666f');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = Palette.graphite;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(40,46,52,0.8)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
      ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEffects(ctx: CanvasRenderingContext2D, effects: EffectSystem): void {
    const ppm = this.camera.pixelsPerMeter();

    for (const ring of effects.ringList) {
      const screen = this.camera.worldToScreen(ring.x, ring.y);
      const alpha = clamp(ring.life / ring.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha * 0.7;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.lineWidth * alpha;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, ring.radius * ppm, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (const particle of effects.particleList) {
      this.drawParticle(ctx, particle, ppm);
    }

    for (const text of effects.textList) {
      const screen = this.camera.worldToScreen(text.x, text.y);
      ctx.save();
      ctx.globalAlpha = clamp(text.life / text.maxLife, 0, 1);
      ctx.fillStyle = text.color;
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.fillText(text.text, screen.x + 6, screen.y);
      ctx.restore();
    }
  }

  private drawParticle(ctx: CanvasRenderingContext2D, particle: Particle, ppm: number): void {
    const screen = this.camera.worldToScreen(particle.x, particle.y);
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    const size = Math.max(1, particle.size * ppm);
    ctx.save();
    ctx.globalAlpha = alpha * (particle.kind === 'dust' || particle.kind === 'smoke' ? 0.5 : 0.95);
    ctx.fillStyle = particle.color;

    switch (particle.kind) {
      case 'glass':
      case 'spark': {
        ctx.translate(screen.x, screen.y);
        ctx.rotate(particle.rotation);
        ctx.fillRect(-size / 2, -size / 4, size, size / 2);
        break;
      }
      case 'smoke': {
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, size * (1.6 - alpha), 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default: {
        ctx.translate(screen.x, screen.y);
        ctx.rotate(particle.rotation);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        break;
      }
    }
    ctx.restore();
  }

  /** Кольцо/трещина из EffectSystem, если нужно дорисовать поверх сцены. */
  drawCrackMark(ctx: CanvasRenderingContext2D, mark: CrackMark): void {
    const screen = this.camera.worldToScreen(mark.x, mark.y);
    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(mark.angle);
    ctx.strokeStyle = 'rgba(18,22,26,0.7)';
    ctx.lineWidth = 1.4;
    for (const branch of mark.branches) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(
        Math.cos(branch.angle) * branch.length * 20,
        Math.sin(branch.angle) * branch.length * 20,
      );
      ctx.stroke();
    }
    ctx.restore();
  }
}
