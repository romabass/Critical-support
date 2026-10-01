import type { LevelDefinition } from '../data/LevelData';

type ReadFile = (path: string, encoding: 'utf8') => Promise<string>;
type FileUrlToPath = (url: string) => string;
type PathJoin = (...parts: string[]) => string;

export type LevelId = string;

export interface LevelEntry {
  readonly id: LevelId;
  readonly title: string;
  readonly file: string;
  readonly maxShots: number;
}

/** Реестр уровней: добавление нового уровня = одна строка здесь + JSON-файл. */
export const LEVELS: readonly LevelEntry[] = [
  {
    id: 'water_tower_01',
    title: 'Старая водонапорная башня',
    file: 'water_tower_01.json',
    maxShots: 3,
  },
];

/**
 * Загрузчик уровней. В браузере читает JSON через import (сборщик включает файл),
 * поэтому уровни остаются конфигурационными, а не зашитыми в код.
 */
/** Проверка наличия Vite-специфичного import.meta.glob без обращения к нему в Node. */
function hasImportMetaGlob(): boolean {
  const meta = import.meta as unknown as { glob?: unknown };
  return typeof meta.glob === 'function';
}

export class LevelManager {
  private readonly cache = new Map<LevelId, LevelDefinition>();

  get levelIds(): readonly LevelId[] {
    return LEVELS.map((l) => l.id);
  }

  get availableLevels(): readonly LevelEntry[] {
    return LEVELS;
  }

  entryFor(id: LevelId): LevelEntry | undefined {
    return LEVELS.find((l) => l.id === id);
  }

  get defaultLevelId(): LevelId {
    const first = LEVELS[0];
    if (!first) throw new Error('В реестре нет ни одного уровня');
    return first.id;
  }

  has(id: LevelId): boolean {
    return this.entryFor(id) !== undefined || this.cache.has(id);
  }

  /** Возвращает уровень из кэша или загружает его. */
  async load(id: LevelId = this.defaultLevelId): Promise<LevelDefinition> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const definition = await this.fetchLevel(id);
    this.cache.set(id, definition);
    return definition;
  }

  /** Синхронный доступ к уже загруженному уровню (используется в тестах). */
  getLoaded(id: LevelId): LevelDefinition | undefined {
    return this.cache.get(id);
  }

  private async fetchLevel(id: LevelId): Promise<LevelDefinition> {
    const entry = this.entryFor(id);
    if (!entry) throw new Error(`Уровень "${id}" не зарегистрирован`);

    if (hasImportMetaGlob()) {
      const modules = import.meta.glob('../levels/*.json', { eager: true }) as Record<
        string,
        { default: unknown }
      >;
      const path = `../levels/${entry.file}`;
      const mod = modules[path];
      if (mod) return mod.default as LevelDefinition;
    }

    // Node/тесты: чтение через fs. Спецификаторы собираются динамически, иначе
    // бандлер попытался бы включить node:fs в браузерную сборку.
    const fs = 'node:fs/promises';
    const url = 'node:url';
    const path = 'node:path';
    const { readFile } = (await import(/* @vite-ignore */ fs)) as { readFile: ReadFile };
    const { fileURLToPath } = (await import(/* @vite-ignore */ url)) as {
      fileURLToPath: FileUrlToPath;
    };
    const { dirname, join } = (await import(/* @vite-ignore */ path)) as {
      dirname: (p: string) => string;
      join: PathJoin;
    };
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = await readFile(join(here, '..', 'levels', entry.file), 'utf8');
    return JSON.parse(raw) as LevelDefinition;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
