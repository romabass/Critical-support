import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import { clamp } from '../core/MathUtils';
import type {
  ObjectiveContext,
  ObjectiveData,
  ObjectiveStatusSnapshot,
} from '../data/ObjectiveData';

export type ObjectiveOutcome = 'pending' | 'completed' | 'violated';

interface EvaluatedObjective {
  readonly snapshot: ObjectiveStatusSnapshot;
  readonly outcome: ObjectiveOutcome;
}

/**
 * Универсальная система целей уровня. Работает только с данными и контекстом,
 * не знает ни о физике, ни о UI. Каждая цель — чистая функция состояния.
 */
export class ObjectiveSystem {
  private readonly objectives: readonly ObjectiveData[];
  private readonly results = new Map<string, EvaluatedObjective>();
  private lastContext: ObjectiveContext | null = null;

  constructor(
    objectives: readonly ObjectiveData[],
    private readonly events: EventBus<GameEvents>,
  ) {
    this.objectives = objectives;
  }

  get count(): number {
    return this.objectives.length;
  }

  get all(): readonly ObjectiveData[] {
    return this.objectives;
  }

  /** Обновляет состояние всех целей. Вызывается после значимых событий. */
  update(context: ObjectiveContext): ObjectiveStatusSnapshot[] {
    this.lastContext = context;
    const snapshots: ObjectiveStatusSnapshot[] = [];

    for (let i = 0; i < this.objectives.length; i++) {
      const objective = this.objectives[i];
      const evaluated = this.evaluate(objective, i, context);
      this.results.set(this.idOf(objective, i), evaluated);
      snapshots.push(evaluated.snapshot);
    }

    this.events.emit('objectives:updated', { snapshot: snapshots });
    return snapshots;
  }

  private idOf(objective: ObjectiveData, index: number): string {
    return `${objective.type}:${objective.group ?? objective.objectId ?? objective.zoneId ?? objective.material ?? index}`;
  }

  private evaluate(
    objective: ObjectiveData,
    index: number,
    ctx: ObjectiveContext,
  ): EvaluatedObjective {
    const id = this.idOf(objective, index);
    const weight = objective.weight ?? 1 / Math.max(1, this.objectives.length);

    switch (objective.type) {
      case 'destroy_group': {
        const group = objective.group as string;
        const stats = ctx.groupStats.get(group) ?? {
          total: 0,
          destroyed: 0,
          totalMass: 0,
          destroyedMass: 0,
        };
        const percent =
          stats.total > 0
            ? (stats.destroyed / stats.total) * 100
            : stats.totalMass > 0
              ? (stats.destroyedMass / stats.totalMass) * 100
              : 0;
        const target = objective.minimumPercent ?? 80;
        const completed = percent >= target - 1e-6;
        return {
          outcome: completed ? 'completed' : 'pending',
          snapshot: {
            id,
            type: objective.type,
            label: objective.label,
            completed,
            violated: false,
            progress: clamp(percent / Math.max(target, 1e-6), 0, 1),
            value: `${percent.toFixed(0)} / ${target} % разрушено (${stats.destroyed}/${stats.total})`,
            failureReason: null,
            weight,
          },
        };
      }

      case 'protect_object': {
        const objectId = objective.objectId as string;
        const damage = ctx.objectDamagePercent.get(objectId) ?? 0;
        const limit = objective.maximumDamage ?? 100;
        const violated = damage > limit + 1e-6;
        return {
          outcome: violated ? 'violated' : 'completed',
          snapshot: {
            id,
            type: objective.type,
            label: objective.label,
            completed: !violated && damage > 0,
            violated,
            progress: clamp(1 - damage / Math.max(limit, 1e-6), 0, 1),
            value: `урон ${damage.toFixed(1)} / ${limit} %`,
            failureReason: violated
              ? `Урон объекту превысил предел: ${damage.toFixed(1)}% > ${limit}%`
              : null,
            weight,
          },
        };
      }

      case 'limit_damage': {
        const objectId = objective.objectId as string;
        const damage = ctx.objectDamagePercent.get(objectId) ?? 0;
        const limit = objective.maximumDamage ?? 100;
        const violated = damage > limit + 1e-6;
        return {
          outcome: violated ? 'violated' : 'completed',
          snapshot: {
            id,
            type: objective.type,
            label: objective.label,
            completed: !violated,
            violated,
            progress: clamp(1 - damage / Math.max(limit, 1e-6), 0, 1),
            value: `${damage.toFixed(1)} / ${limit} %`,
            failureReason: violated ? `Превышен допустимый урон: ${damage.toFixed(1)}%` : null,
            weight,
          },
        };
      }

      case 'limit_shots': {
        const limit = objective.shotLimit ?? Number.MAX_SAFE_INTEGER;
        const violated = ctx.shotsUsed > limit;
        return {
          outcome: violated ? 'violated' : 'completed',
          snapshot: {
            id,
            type: objective.type,
            label: objective.label,
            completed: ctx.shotsUsed <= limit,
            violated,
            progress: clamp(1 - ctx.shotsUsed / Math.max(limit, 1), 0, 1),
            value: `${ctx.shotsUsed} / ${limit} запусков`,
            failureReason: violated
              ? `Использовано ${ctx.shotsUsed} запусков при лимите ${limit}`
              : null,
            weight,
          },
        };
      }

      case 'zone_debris_limit': {
        const zoneId = objective.zoneId as string;
        const mass = ctx.zoneDebrisMass.get(zoneId) ?? 0;
        const limit = objective.maximumDebrisMass ?? 0;
        const violated = mass > limit + 1e-6;
        return {
          outcome: violated ? 'violated' : 'completed',
          snapshot: {
            id,
            type: objective.type,
            label: objective.label,
            completed: !violated,
            violated,
            progress: clamp(1 - mass / Math.max(limit, 1e-6), 0, 1),
            value: `${Math.round(mass)} / ${Math.round(limit)} кг`,
            failureReason: violated
              ? `Масса обломков в зоне превысила лимит: ${Math.round(mass)} > ${Math.round(limit)} кг`
              : null,
            weight,
          },
        };
      }

      case 'safe_debris_minimum': {
        const zoneId = objective.zoneId ?? 'green_zone';
        const mass = ctx.safeZoneDebrisMass.get(zoneId) ?? 0;
        const target = objective.minimumDebrisMass ?? 0;
        const completed = mass >= target - 1e-6;
        return {
          outcome: completed ? 'completed' : 'pending',
          snapshot: {
            id,
            type: objective.type,
            label: objective.label,
            completed,
            violated: false,
            progress: clamp(mass / Math.max(target, 1e-6), 0, 1),
            value: `${Math.round(mass)} / ${Math.round(target)} кг в безопасной зоне`,
            failureReason: null,
            weight,
          },
        };
      }

      case 'preserve_material': {
        const material = objective.material;
        if (!material) {
          return {
            outcome: 'violated',
            snapshot: {
              id,
              type: objective.type,
              label: objective.label,
              completed: false,
              violated: true,
              progress: 0,
              value: '—',
              failureReason: 'Цель preserve_material не указала материал',
              weight,
            },
          };
        }
        const damage = ctx.materialDamagePercent.get(material) ?? 0;
        const limit = objective.maximumDamage ?? 100;
        const violated = damage > limit + 1e-6;
        return {
          outcome: violated ? 'violated' : 'completed',
          snapshot: {
            id,
            type: objective.type,
            label: objective.label,
            completed: !violated,
            violated,
            progress: clamp(1 - damage / Math.max(limit, 1e-6), 0, 1),
            value: `повреждение ${damage.toFixed(1)} / ${limit} %`,
            failureReason: violated
              ? `Материал повреждён сверх нормы: ${damage.toFixed(1)}%`
              : null,
            weight,
          },
        };
      }

      case 'time_limit': {
        const limit = objective.timeLimitSeconds ?? 0;
        const violated = ctx.elapsedSeconds > limit;
        return {
          outcome: violated ? 'violated' : 'pending',
          snapshot: {
            id,
            type: objective.type,
            label: objective.label,
            completed: false,
            violated,
            progress: clamp(1 - ctx.elapsedSeconds / Math.max(limit, 1), 0, 1),
            value: `${ctx.elapsedSeconds.toFixed(1)} / ${limit} с`,
            failureReason: violated ? 'Превышено время выполнения задания' : null,
            weight,
          },
        };
      }

      default: {
        return {
          outcome: 'pending',
          snapshot: {
            id,
            type: objective.type,
            label: objective.label,
            completed: false,
            violated: false,
            progress: 0,
            value: '—',
            failureReason: `Неизвестный тип цели: ${String(objective.type)}`,
            weight,
          },
        };
      }
    }
  }

  /** Все цели выполнены. */
  get allCompleted(): boolean {
    if (this.results.size === 0) return false;
    return [...this.results.values()].every((r) => r.snapshot.completed);
  }

  /** Есть нарушенная цель — это причина поражения. */
  get hasViolation(): boolean {
    return [...this.results.values()].some((r) => r.snapshot.violated);
  }

  /** Первая причина поражения. */
  get failureReason(): string | null {
    for (const r of this.results.values()) {
      if (r.snapshot.violated) return r.snapshot.failureReason;
    }
    return null;
  }

  /** Доля выполненного веса целей, 0..1. */
  get completionRatio(): number {
    let total = 0;
    let done = 0;
    for (const r of this.results.values()) {
      total += r.snapshot.weight;
      if (r.snapshot.completed) done += r.snapshot.weight;
    }
    return total > 0 ? done / total : 0;
  }

  statuses(): ObjectiveStatusSnapshot[] {
    return [...this.results.values()].map((r) => r.snapshot);
  }

  get pendingCount(): number {
    return [...this.results.values()].filter((r) => !r.snapshot.completed && !r.snapshot.violated)
      .length;
  }

  reset(): void {
    this.results.clear();
    this.lastContext = null;
  }

  get context(): ObjectiveContext | null {
    return this.lastContext;
  }
}
