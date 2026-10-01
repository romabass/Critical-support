import type { Joint } from 'planck';

import { clamp } from '../core/MathUtils';
import type { StructuralElement } from './StructuralElement';

export type ConnectionKind = 'weld' | 'bolt' | 'mortar';
export type ConnectionState = 'intact' | 'weakened' | 'broken';

export interface ConnectionBreakInfo {
  readonly connectionId: string;
  readonly elementId: string;
  readonly loadRatio: number;
}

/**
 * Связь между двумя элементами конструкции.
 * Физически реализована сварным соединением planck; логически хранит
 * накопленную нагрузку, порог разрушения и состояние.
 */
export class StructuralConnection {
  readonly id: string;
  readonly aId: string;
  readonly bId: string;
  readonly kind: ConnectionKind;
  readonly critical: boolean;
  readonly strength: number;
  readonly breakImpulse: number;

  state: ConnectionState = 'intact';
  /** Накопленная нагрузка в ньютонах (оценка сверху). */
  load = 0;
  /** Пиковая нагрузка за всё время — используется для анализа. */
  peakLoad = 0;
  /** Коэффициент ослабления 0..1 (1 — целая). */
  integrity = 1;
  joint: Joint | null = null;
  brokenAt: number | null = null;

  constructor(options: {
    id: string;
    a: StructuralElement;
    b: StructuralElement;
    kind?: ConnectionKind;
    critical?: boolean;
    strength?: number;
    breakImpulse?: number;
  }) {
    this.id = options.id;
    this.aId = options.a.id;
    this.bId = options.b.id;
    this.kind = options.kind ?? 'weld';
    this.critical = options.critical ?? false;
    this.strength = options.strength ?? defaultStrengthFor(this.kind);
    this.breakImpulse = options.breakImpulse ?? this.strength * 0.045;
  }

  private _a: StructuralElement | null = null;
  private _b: StructuralElement | null = null;

  get a(): StructuralElement | null {
    return this._a;
  }

  get b(): StructuralElement | null {
    return this._b;
  }

  attach(a: StructuralElement, b: StructuralElement): void {
    this._a = a;
    this._b = b;
  }

  get isBroken(): boolean {
    return this.state === 'broken';
  }

  /** Отношение нагрузки к прочности, 0..N. */
  get loadRatio(): number {
    return this.strength > 0 ? this.load / this.strength : 0;
  }

  /** Эффективная прочность с учётом накопленных повреждений. */
  get effectiveStrength(): number {
    return this.strength * clamp(this.integrity, 0.05, 1);
  }

  /** Насколько близка связь к разрушению, 0..1. */
  get stressRatio(): number {
    return this.effectiveStrength > 0 ? clamp(this.load / this.effectiveStrength, 0, 1) : 1;
  }

  /** Регистрирует нагрузку/импульс. Возвращает true, если связь разрушена. */
  registerLoad(force: number, impulse = 0): boolean {
    if (this.isBroken) return true;
    // Импульс переводится в эквивалентную нагрузку: impulse / breakImpulse — доля прочности.
    const delta = force + impulse * IMPULSE_UNIT_SCALE;
    this.load = Math.max(0, this.load + delta);
    this.peakLoad = Math.max(this.peakLoad, this.load);
    if (this.load >= this.effectiveStrength) {
      this.breakInternal();
      return true;
    }
    if (this.stressRatio > 0.65) {
      this.state = 'weakened';
    }
    return false;
  }

  /** Дополнительный импульс от снаряда (без постоянной нагрузки). */
  applyImpulse(impulse: number): boolean {
    if (this.isBroken) return true;
    if (impulse >= this.breakImpulse) {
      this.breakInternal();
      return true;
    }
    // Частичное повреждение связи от попадания рядом.
    this.integrity = clamp(this.integrity - impulse / (this.breakImpulse * 6), 0.15, 1);
    if (this.integrity < 0.4) this.state = 'weakened';
    return false;
  }

  /** Ослабление связи из-за взрывного эффекта снаряда. */
  weaken(factor: number): boolean {
    if (this.isBroken) return true;
    this.integrity = clamp(this.integrity * (1 - factor), 0.05, 1);
    if (this.integrity <= 0.2) {
      this.breakInternal();
      return true;
    }
    this.state = 'weakened';
    return false;
  }

  /** Разрушение связи из-за разрушения одного из элементов. */
  breakInternal(): void {
    if (this.isBroken) return;
    this.state = 'broken';
    this.load = Math.max(this.load, this.effectiveStrength);
  }

  reset(): void {
    this.state = 'intact';
    this.load = 0;
    this.peakLoad = 0;
    this.integrity = 1;
    this.brokenAt = null;
  }

  detachJoints(): void {
    this.joint = null;
  }
}

/**
 * Масштаб перевода импульса (Н·с) в эквивалентную нагрузку (Н).
 * Импульс F·t при характерном времени удара ~0.05 с даёт усилие порядка 20·F.
 */
const IMPULSE_UNIT_SCALE = 20;

const DEFAULT_STRENGTH: Record<ConnectionKind, number> = {
  weld: 4000,
  bolt: 2200,
  mortar: 1400,
};

export function defaultStrengthFor(kind: ConnectionKind): number {
  return DEFAULT_STRENGTH[kind];
}
