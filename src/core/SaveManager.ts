import type { EventBus } from './EventBus';
import type { GameEvents } from './GameEvents';

export interface SaveSettings {
  readonly sfxVolume: number;
  readonly musicVolume: number;
  readonly particleQuality: 'low' | 'medium' | 'high';
  readonly debugMode: boolean;
  readonly fullscreen: boolean;
  readonly showTrajectory: boolean;
}

export interface LevelRecord {
  readonly completed: boolean;
  readonly bestScore: number;
  readonly bestRank: string;
  readonly minimumShots: number | null;
  readonly bestGeneratorHealth: number;
  readonly attempts: number;
  readonly lastPlayedAt: number;
}

export interface SaveData {
  readonly version: number;
  readonly settings: SaveSettings;
  readonly levels: Record<string, LevelRecord>;
}

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'critical-support/save/v1';

export const DEFAULT_SETTINGS: SaveSettings = {
  sfxVolume: 0.7,
  musicVolume: 0.4,
  particleQuality: 'high',
  debugMode: false,
  fullscreen: false,
  showTrajectory: true,
};

export function emptySaveData(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    levels: {},
  };
}

/** Абстракция хранилища: позволяет тестировать без DOM и localStorage. */
export interface StorageBackend {
  read(key: string): string | null;
  write(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStorageBackend implements StorageBackend {
  private readonly map = new Map<string, string>();

  read(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  write(key: string, value: string): void {
    this.map.set(key, value);
  }

  remove(key: string): void {
    this.map.delete(key);
  }
}

/** localStorage-адаптер; при недоступности хранилища используется память. */
export function createDefaultStorage(): StorageBackend {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '__cs_probe__';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return {
        read: (key) => localStorage.getItem(key),
        write: (key, value) => localStorage.setItem(key, value),
        remove: (key) => localStorage.removeItem(key),
      };
    }
  } catch {
    /* приватный режим браузера — падаем на память */
  }
  return new MemoryStorageBackend();
}

/** Миграция и валидация данных сохранения. */
export function migrateSaveData(raw: unknown): SaveData {
  const base = emptySaveData();
  if (!raw || typeof raw !== 'object') return base;
  const data = raw as Partial<SaveData>;

  const settings: SaveSettings = {
    sfxVolume: clampVolume(data.settings?.sfxVolume, base.settings.sfxVolume),
    musicVolume: clampVolume(data.settings?.musicVolume, base.settings.musicVolume),
    particleQuality: isParticleQuality(data.settings?.particleQuality)
      ? data.settings.particleQuality
      : base.settings.particleQuality,
    debugMode: Boolean(data.settings?.debugMode),
    fullscreen: Boolean(data.settings?.fullscreen),
    showTrajectory:
      data.settings?.showTrajectory === undefined ? true : Boolean(data.settings.showTrajectory),
  };

  const levels: Record<string, LevelRecord> = {};
  for (const [id, record] of Object.entries(data.levels ?? {})) {
    if (!record || typeof record !== 'object') continue;
    levels[id] = {
      completed: Boolean(record.completed),
      bestScore: finiteOr(record.bestScore, 0),
      bestRank: typeof record.bestRank === 'string' ? record.bestRank : 'Нет результата',
      minimumShots:
        typeof record.minimumShots === 'number' && Number.isFinite(record.minimumShots)
          ? record.minimumShots
          : null,
      bestGeneratorHealth: clampVolume(record.bestGeneratorHealth, 0),
      attempts: finiteOr(record.attempts, 0),
      lastPlayedAt: finiteOr(record.lastPlayedAt, 0),
    };
  }

  return { version: SAVE_VERSION, settings, levels };
}

function clampVolume(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(1, Math.max(0, n));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isParticleQuality(value: unknown): value is SaveSettings['particleQuality'] {
  return value === 'low' || value === 'medium' || value === 'high';
}

/**
 * Локальное сохранение: лучший счёт, рекорды уровня, настройки.
 * Все операции безопасны при повреждённых данных.
 */
export class SaveManager {
  private data: SaveData;
  private readonly backend: StorageBackend;
  private readonly key: string;

  constructor(
    private readonly events: EventBus<GameEvents>,
    backend: StorageBackend = createDefaultStorage(),
    key: string = SAVE_KEY,
  ) {
    this.backend = backend;
    this.key = key;
    this.data = this.load();
  }

  load(): SaveData {
    const raw = this.backend.read(this.key);
    if (!raw) {
      this.data = emptySaveData();
      return this.data;
    }
    try {
      this.data = migrateSaveData(JSON.parse(raw));
    } catch {
      this.data = emptySaveData();
    }
    return this.data;
  }

  save(): void {
    try {
      this.backend.write(this.key, JSON.stringify(this.data));
    } catch (error) {
      console.warn('[SaveManager] не удалось сохранить данные', error);
    }
  }

  get currentSettings(): SaveSettings {
    return this.data.settings;
  }

  getLevelRecord(levelId: string): LevelRecord | null {
    return this.data.levels[levelId] ?? null;
  }

  updateSettings(patch: Partial<SaveSettings>): SaveSettings {
    this.data = {
      ...this.data,
      settings: { ...this.data.settings, ...patch },
    };
    this.events.emit('settings:changed', patch);
    this.save();
    return this.data.settings;
  }

  /** Записывает результат прохождения. Возвращает обновлённую запись. */
  recordResult(
    levelId: string,
    result: {
      completed: boolean;
      score: number;
      rank: string;
      shotsUsed: number;
      generatorHealthRatio: number;
      timestamp?: number;
    },
  ): LevelRecord {
    const previous = this.data.levels[levelId];
    const next: LevelRecord = {
      completed: (previous?.completed ?? false) || result.completed,
      bestScore: Math.max(previous?.bestScore ?? 0, result.score),
      bestRank:
        result.score >= (previous?.bestScore ?? 0)
          ? result.rank
          : (previous?.bestRank ?? 'Нет результата'),
      minimumShots:
        previous?.minimumShots === null || previous?.minimumShots === undefined
          ? result.shotsUsed
          : Math.min(previous.minimumShots, result.shotsUsed),
      bestGeneratorHealth: Math.max(
        previous?.bestGeneratorHealth ?? 0,
        result.generatorHealthRatio,
      ),
      attempts: (previous?.attempts ?? 0) + 1,
      lastPlayedAt: result.timestamp ?? Date.now(),
    };
    this.data = { ...this.data, levels: { ...this.data.levels, [levelId]: next } };
    this.save();
    return next;
  }

  hasCompleted(levelId: string): boolean {
    return this.data.levels[levelId]?.completed ?? false;
  }

  /** Полный сброс прогресса, но с сохранением настроек. */
  resetProgress(): void {
    this.data = { ...this.data, levels: {} };
    this.save();
  }

  /** Полный сброс всего. */
  resetAll(): void {
    this.backend.remove(this.key);
    this.data = emptySaveData();
    this.save();
  }

  get raw(): SaveData {
    return this.data;
  }
}
