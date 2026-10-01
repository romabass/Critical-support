import type { MaterialId } from './MaterialProperties';

export type ObjectiveType =
  | 'destroy_group'
  | 'protect_object'
  | 'limit_damage'
  | 'limit_shots'
  | 'zone_debris_limit'
  | 'preserve_material'
  | 'time_limit'
  | 'safe_debris_minimum';

/** Сырые данные цели из конфигурации уровня. Содержат только данные. */
export interface ObjectiveData {
  readonly type: ObjectiveType;
  readonly label: string;
  /** Группа элементов для destroy_group / preserve_material. */
  readonly group?: string;
  /** Минимальный процент разрушения группы. */
  readonly minimumPercent?: number;
  /** Идентификатор защищаемого объекта. */
  readonly objectId?: string;
  /** Максимально допустимый урон в процентах. */
  readonly maximumDamage?: number;
  /** Идентификатор зоны. */
  readonly zoneId?: string;
  /** Максимальная масса обломков в зоне. */
  readonly maximumDebrisMass?: number;
  /** Минимальная безопасная масса обломков. */
  readonly minimumDebrisMass?: number;
  /** Материал для preserve_material. */
  readonly material?: MaterialId;
  /** Лимит времени в секундах. */
  readonly timeLimitSeconds?: number;
  /** Лимит числа запусков для limit_shots. */
  readonly shotLimit?: number;
  /** Минимальная разрушенная масса для группы (альтернатива проценту). */
  readonly minimumDestroyedMass?: number;
  /** Вес цели в проценте итогового бонуса (0..1). По умолчанию равномерно. */
  readonly weight?: number;
}

/** Контекст выполнения цели. */
export interface ObjectiveContext {
  readonly groupStats: ReadonlyMap<
    string,
    { total: number; destroyed: number; totalMass: number; destroyedMass: number }
  >;
  readonly objectDamagePercent: ReadonlyMap<string, number>;
  readonly zoneDebrisMass: ReadonlyMap<string, number>;
  readonly safeZoneDebrisMass: ReadonlyMap<string, number>;
  readonly materialDamagePercent: ReadonlyMap<MaterialId, number>;
  readonly shotsUsed: number;
  readonly elapsedSeconds: number;
}

export interface ObjectiveStatusSnapshot {
  readonly id: string;
  readonly type: ObjectiveType;
  readonly label: string;
  readonly completed: boolean;
  readonly violated: boolean;
  /** Прогресс 0..1. */
  readonly progress: number;
  /** Человекочитаемое значение, например "72 / 80 %". */
  readonly value: string;
  /** Причина поражения, если violated. */
  readonly failureReason: string | null;
  readonly weight: number;
}
