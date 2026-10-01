import type { MaterialVisualStyle } from './Palette';
import { Palette } from './Palette';
import { clamp } from '../core/MathUtils';

export type ParticleKind = 'dust' | 'spark' | 'glass' | 'concrete' | 'wood' | 'smoke' | 'ring';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  rotation: number;
  spin: number;
  color: string;
  kind: ParticleKind;
  gravityScale: number;
}

export interface CrackMark {
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly branches: readonly { angle: number; length: number }[];
  readonly severity: number;
  age: number;
}

export interface ImpactRing {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
  lineWidth: number;
}

export interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
}

export type QualityLevel = 'low' | 'medium' | 'high';

export interface EffectConfig {
  readonly maxParticles: number;
  readonly maxCracks: number;
  readonly maxRings: number;
  readonly maxTexts: number;
  readonly gravity: number;
  readonly enableTrails: boolean;
  readonly enableScreenShake: boolean;
  readonly enableDust: boolean;
}

const QUALITY_PRESETS: Record<QualityLevel, EffectConfig> = {
  low: {
    maxParticles: 120,
    maxCracks: 30,
    maxRings: 8,
    maxTexts: 8,
    gravity: 1,
    enableTrails: false,
    enableScreenShake: false,
    enableDust: false,
  },
  medium: {
    maxParticles: 320,
    maxCracks: 80,
    maxRings: 14,
    maxTexts: 14,
    gravity: 1,
    enableTrails: true,
    enableScreenShake: true,
    enableDust: true,
  },
  high: {
    maxParticles: 700,
    maxCracks: 160,
    maxRings: 24,
    maxTexts: 24,
    gravity: 1,
    enableTrails: true,
    enableScreenShake: true,
    enableDust: true,
  },
};

const KIND_COLORS: Record<ParticleKind, string> = {
  dust: '#c2cbd0',
  spark: '#ffd58a',
  glass: '#bfe8ef',
  concrete: '#9aa3a8',
  wood: '#c99657',
  smoke: '#5c646b',
  ring: '#e8823a',
};

/**
 * Процедурные визуальные эффекты: частицы, трещины, кольца удара, всплывающий текст.
 * Все данные — обычные структуры; отрисовка выполняется рендерером.
 */
export class EffectSystem {
  private readonly particles: Particle[] = [];
  private readonly cracks: CrackMark[] = [];
  private readonly rings: ImpactRing[] = [];
  private readonly texts: FloatText[] = [];
  private config: EffectConfig;
  private rngState = 12345;

  constructor(
    quality: QualityLevel = 'high',
    private gravity = 18,
  ) {
    this.config = QUALITY_PRESETS[quality];
  }

  static presetFor(quality: QualityLevel): EffectConfig {
    return QUALITY_PRESETS[quality];
  }

  setQuality(quality: QualityLevel): void {
    this.config = QUALITY_PRESETS[quality];
    this.trim();
  }

  get quality(): QualityConfigView {
    return { ...this.config };
  }

  get particleCount(): number {
    return this.particles.length;
  }

  get crackCount(): number {
    return this.cracks.length;
  }

  get ringCount(): number {
    return this.rings.length;
  }

  get textCount(): number {
    return this.texts.length;
  }

  get particleList(): readonly Particle[] {
    return this.particles;
  }

  get crackList(): readonly CrackMark[] {
    return this.cracks;
  }

  get ringList(): readonly ImpactRing[] {
    return this.rings;
  }

  get textList(): readonly FloatText[] {
    return this.texts;
  }

  private random(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  private trim(): void {
    while (this.particles.length > this.config.maxParticles) this.particles.shift();
    while (this.cracks.length > this.config.maxCracks) this.cracks.shift();
    while (this.rings.length > this.config.maxRings) this.rings.shift();
    while (this.texts.length > this.config.maxTexts) this.texts.shift();
  }

  /** Взрыв частиц при ударе. */
  burst(options: {
    x: number;
    y: number;
    count?: number;
    kind?: ParticleKind;
    speed?: number;
    spread?: number;
    angle?: number;
    size?: number;
    life?: number;
    color?: string;
  }): void {
    const count = Math.floor((options.count ?? 14) * (this.config.maxParticles / 700));
    const speed = options.speed ?? 6;
    const spread = options.spread ?? Math.PI * 2;
    const baseAngle = options.angle ?? 0;
    const kind = options.kind ?? 'dust';
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (this.random() - 0.5) * spread;
      const s = speed * (0.35 + this.random() * 0.9);
      const life = (options.life ?? 0.7) * (0.6 + this.random() * 0.8);
      this.particles.push({
        x: options.x,
        y: options.y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        maxLife: life,
        size: (options.size ?? 0.09) * (0.5 + this.random()),
        rotation: this.random() * Math.PI,
        spin: (this.random() - 0.5) * 8,
        color: options.color ?? KIND_COLORS[kind],
        kind,
        gravityScale: kind === 'dust' || kind === 'smoke' ? 0.16 : 0.9,
      });
    }
    this.trim();
  }

  /** Пыль при разрушении бетона/грунта. */
  dust(x: number, y: number, amount = 1): void {
    if (!this.config.enableDust) return;
    this.burst({
      x,
      y,
      count: Math.round(18 * amount),
      kind: 'dust',
      speed: 3.2,
      spread: Math.PI * 1.1,
      life: 1.4,
      size: 0.18,
    });
  }

  /** Искры при ударе по металлу. */
  sparks(x: number, y: number, amount = 1): void {
    this.burst({
      x,
      y,
      count: Math.round(10 * amount),
      kind: 'spark',
      speed: 9,
      life: 0.42,
      size: 0.05,
    });
  }

  /** Осколки по материалу. */
  debrisByStyle(style: MaterialVisualStyle, x: number, y: number, amount = 1): void {
    switch (style) {
      case 'glass':
        this.burst({
          x,
          y,
          count: Math.round(20 * amount),
          kind: 'glass',
          speed: 7,
          life: 0.85,
          size: 0.06,
        });
        break;
      case 'wood':
        this.burst({
          x,
          y,
          count: Math.round(12 * amount),
          kind: 'wood',
          speed: 5.5,
          life: 1.1,
          size: 0.1,
        });
        break;
      case 'concrete':
        this.burst({
          x,
          y,
          count: Math.round(16 * amount),
          kind: 'concrete',
          speed: 6,
          life: 1.3,
          size: 0.14,
        });
        this.dust(x, y, amount);
        break;
      case 'steel':
        this.sparks(x, y, amount * 1.4);
        break;
      case 'machine':
        this.burst({
          x,
          y,
          count: Math.round(14 * amount),
          kind: 'spark',
          speed: 7.5,
          life: 0.6,
          size: 0.06,
        });
        this.burst({
          x,
          y,
          count: Math.round(10 * amount),
          kind: 'smoke',
          speed: 2.6,
          life: 1.5,
          size: 0.2,
        });
        break;
      default:
        this.burst({ x, y, count: 8, kind: 'dust', speed: 3 });
        break;
    }
  }

  /** Трещина на элементе. */
  addCrack(x: number, y: number, angle: number, severity: number): void {
    const branches: { angle: number; length: number }[] = [];
    const count = 2 + Math.floor(severity * 3);
    for (let i = 0; i < count; i++) {
      branches.push({
        angle: (this.random() - 0.5) * 1.5,
        length: (0.2 + this.random() * 0.6) * clamp(severity, 0.2, 1.4),
      });
    }
    this.cracks.push({ x, y, angle, branches, severity: clamp(severity, 0.1, 1.5), age: 0 });
    this.trim();
  }

  /** Кольцо ударной волны. */
  addRing(
    x: number,
    y: number,
    maxRadius: number,
    color: string = Palette.orange,
    life = 0.3,
  ): void {
    this.rings.push({
      x,
      y,
      radius: 0.05,
      maxRadius,
      life,
      maxLife: life,
      color,
      lineWidth: 2.4,
    });
    this.trim();
  }

  /** Всплывающий текст (урон, масса). */
  addText(x: number, y: number, text: string, color = Palette.textPrimary): void {
    this.texts.push({ x, y, vy: 2.1, life: 1.1, maxLife: 1.1, text, color });
    this.trim();
  }

  /** След снаряда: добавляет искры вдоль движения. */
  trailStep(x: number, y: number, vx: number, vy: number): void {
    if (!this.config.enableTrails) return;
    if (this.random() > 0.55) return;
    const len = Math.hypot(vx, vy) || 1;
    this.particles.push({
      x,
      y,
      vx: -vx * 0.06 + (this.random() - 0.5) * 0.6,
      vy: -vy * 0.06 + (this.random() - 0.5) * 0.6,
      life: 0.28,
      maxLife: 0.28,
      size: 0.055,
      rotation: 0,
      spin: 0,
      color: Palette.orange,
      kind: 'spark',
      gravityScale: 0.1,
    });
    void len;
    this.trim();
  }

  /** Физический шаг эффектов. */
  update(dt: number): void {
    const g = this.gravity * this.config.gravity;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= g * p.gravityScale * dt;
      const damping = p.kind === 'dust' || p.kind === 'smoke' ? 0.985 : 0.995;
      p.vx *= damping;
      p.vy *= damping;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
      if (p.y < 0) {
        p.y = 0;
        p.vy = Math.abs(p.vy) * 0.24;
        p.vx *= 0.7;
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      r.radius = r.maxRadius * (1 - Math.pow(1 - t, 2.4));
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      t.y += t.vy * dt;
      t.vy *= 0.94;
    }

    for (const crack of this.cracks) crack.age += dt;
  }

  clear(): void {
    this.particles.length = 0;
    this.cracks.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
    this.rngState = 12345;
  }
}

export type QualityConfigView = EffectConfig;
