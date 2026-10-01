import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import { clamp } from '../core/MathUtils';
import type { ObjectiveSystem } from './ObjectiveSystem';

export type Rank = 'Нет результата' | 'Bronze' | 'Silver' | 'Gold' | 'Perfect Demolition';

export interface ScoringInput {
  readonly won: boolean;
  readonly shotsUsed: number;
  readonly parShots: number;
  readonly objectivesCompletion: number;
  readonly generatorHealthRatio: number;
  readonly redZoneDebrisMass: number;
  readonly redZoneLimit: number;
  readonly greenZoneDebrisMass: number;
  readonly greenZoneTarget: number;
  readonly destroyedGroupRatio: number;
  readonly unusedShots: number;
  readonly maxShots: number;
  readonly timeSeconds: number;
}

export interface ScoreBreakdown {
  readonly baseScore: number;
  readonly objectiveBonus: number;
  readonly generatorBonus: number;
  readonly safeDebrisBonus: number;
  readonly accuracyBonus: number;
  readonly shotPenalty: number;
  readonly redZonePenalty: number;
  readonly unnecessaryDamagePenalty: number;
  readonly timeBonus: number;
  readonly total: number;
}

export const SCORE_CONFIG = {
  baseScore: 500,
  objectiveBonusMax: 1200,
  generatorBonusMax: 500,
  safeDebrisBonusMax: 400,
  accuracyBonusMax: 350,
  shotPenaltyPerExtra: 90,
  redZonePenaltyPerRatio: 450,
  unnecessaryDamagePenaltyMax: 300,
  timeBonusMax: 150,
  parTimeSeconds: 45,
} as const;

export const RANK_THRESHOLDS: readonly { readonly rank: Rank; readonly score: number }[] = [
  { rank: 'Perfect Demolition', score: 2400 },
  { rank: 'Gold', score: 1900 },
  { rank: 'Silver', score: 1300 },
  { rank: 'Bronze', score: 700 },
];

const RANK_NAMES: readonly string[] = ['Нет результата', ...RANK_THRESHOLDS.map((t) => t.rank)];

/** Ранг приходит из сохранения строкой, поэтому нужна проверка на известное значение. */
export function asRank(value: string | null | undefined): Rank {
  return value && RANK_NAMES.includes(value) ? (value as Rank) : 'Нет результата';
}

/**
 * Подсчёт очков. Формула:
 * score = base + objective + generator + safeDebris + accuracy - shot - redZone - damage
 * Все компоненты видны в breakdown для экрана результата.
 */
export class ScoringSystem {
  private latest: ScoreBreakdown = emptyBreakdown();

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly config: typeof SCORE_CONFIG = SCORE_CONFIG,
  ) {}

  get current(): ScoreBreakdown {
    return this.latest;
  }

  compute(input: ScoringInput, objectives?: ObjectiveSystem): ScoreBreakdown {
    const c = this.config;

    const baseScore = input.won ? c.baseScore : 0;

    // Бонус за цели: доля выполненного веса × максимум.
    const objectiveBonus = input.won
      ? Math.round(clamp(input.objectivesCompletion, 0, 1) * c.objectiveBonusMax)
      : 0;

    // Бонус за сохранность генератора: полное здоровье даёт максимум.
    const generatorBonus = input.won
      ? Math.round(clamp(input.generatorHealthRatio, 0, 1) * c.generatorBonusMax)
      : 0;

    // Бонус за направление обломков в безопасную зону.
    const greenRatio =
      input.greenZoneTarget > 0
        ? clamp(input.greenZoneDebrisMass / input.greenZoneTarget, 0, 1.25)
        : 0;
    const safeDebrisBonus = input.won
      ? Math.round(clamp(greenRatio, 0, 1) * c.safeDebrisBonusMax)
      : 0;

    // Точность: попадание с первого раза и экономия боезапаса.
    const par = Math.max(1, input.parShots || input.maxShots);
    const efficiency = clamp(1 - (input.shotsUsed - par) / Math.max(par, 1), -1, 1);
    const accuracyBonus = input.won
      ? Math.round(
          Math.max(0, efficiency) *
            c.accuracyBonusMax *
            (0.5 + 0.5 * clamp(input.destroyedGroupRatio, 0, 1)),
        )
      : 0;

    // Штраф за каждый запуск сверх паритета.
    const extraShots = Math.max(0, input.shotsUsed - par);
    const shotPenalty = -extraShots * c.shotPenaltyPerExtra;

    // Штраф за перегрузку красной зоны относительно лимита.
    const redRatio =
      input.redZoneLimit > 0 ? clamp(input.redZoneDebrisMass / input.redZoneLimit, 0, 2) : 0;
    const redZonePenalty = -Math.round(Math.max(0, redRatio - 1) * c.redZonePenaltyPerRatio);

    // Штраф за ненужные повреждения: низкий процент разрушения при высоком счёте урона.
    const unnecessaryDamagePenalty = -Math.round(
      clamp(
        (1 - input.destroyedGroupRatio) * 0.5 * c.unnecessaryDamagePenaltyMax,
        0,
        c.unnecessaryDamagePenaltyMax,
      ),
    );

    const timeBonus = input.won
      ? Math.round(clamp(1 - input.timeSeconds / c.parTimeSeconds, 0, 1) * c.timeBonusMax)
      : 0;

    const total = Math.max(
      0,
      Math.round(
        baseScore +
          objectiveBonus +
          generatorBonus +
          safeDebrisBonus +
          accuracyBonus +
          timeBonus +
          shotPenalty +
          redZonePenalty +
          unnecessaryDamagePenalty,
      ),
    );

    this.latest = {
      baseScore,
      objectiveBonus,
      generatorBonus,
      safeDebrisBonus,
      accuracyBonus,
      shotPenalty,
      redZonePenalty,
      unnecessaryDamagePenalty,
      timeBonus,
      total,
    };

    void objectives;
    this.events.emit('score:updated', { score: total, breakdown: this.latest });
    return this.latest;
  }

  static rankFor(score: number): Rank {
    for (const t of RANK_THRESHOLDS) {
      if (score >= t.score) return t.rank;
    }
    return 'Нет результата';
  }

  get rank(): Rank {
    return ScoringSystem.rankFor(this.latest.total);
  }

  reset(): void {
    this.latest = emptyBreakdown();
  }
}

function emptyBreakdown(): ScoreBreakdown {
  return {
    baseScore: 0,
    objectiveBonus: 0,
    generatorBonus: 0,
    safeDebrisBonus: 0,
    accuracyBonus: 0,
    shotPenalty: 0,
    redZonePenalty: 0,
    unnecessaryDamagePenalty: 0,
    timeBonus: 0,
    total: 0,
  };
}
