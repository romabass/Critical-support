import { describe, expect, it } from 'vitest';

import { createCanvas } from '@napi-rs/canvas';

import { GameApp, type GameCanvas } from '../../src/app/GameApp';
import { GameState } from '../../src/core/GameStateManager';
import {
  DEFAULT_SETTINGS,
  MemoryStorageBackend,
  SAVE_KEY,
  type LevelRecord,
  type SaveSettings,
} from '../../src/core/SaveManager';

const WIDTH = 1280;
const HEIGHT = 720;

/**
 * Загрузка уровня асинхронна: JSON в Node читается через динамический import,
 * поэтому одних микрозадач мало — ждём несколько витков event loop.
 */
/**
 * Ожидание условия вместо фиксированного числа витков event loop: загрузка уровня
 * идёт через динамический import, и её длительность зависит от того, прогрет ли
 * кэш модулей. Фиксированное число витков давало плавающие падения — уровень
 * ещё не успевал загрузиться.
 */
async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Не дождались выполнения условия');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Старт уровня завершён, когда сессия создана и состояние перешло в Playing. */
async function waitForPlaying(app: GameApp): Promise<void> {
  await waitFor(() => app.states.is(GameState.Playing) && app.currentSession !== null);
}

/** Canvas из @napi-rs/canvas с минимальными DOM-методами, которые ждёт GameApp. */
function makeCanvas(): GameCanvas & {
  pointerMove(x: number, y: number): void;
  pointerDown(x: number, y: number): void;
  pointerUp(x: number, y: number): void;
} {
  const canvas = createCanvas(WIDTH, HEIGHT) as unknown as GameCanvas;
  const listeners = new Map<string, (event: never) => void>();
  const withDom = canvas as GameCanvas & {
    listeners: Map<string, (event: never) => void>;
  };
  withDom.listeners = listeners;
  withDom.style = { width: `${WIDTH}px`, height: `${HEIGHT}px` };
  withDom.getBoundingClientRect = () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT });
  withDom.addEventListener = (type, handler) => listeners.set(type, handler);
  withDom.removeEventListener = (type) => listeners.delete(type);

  const emit = (type: string, x: number, y: number): void => {
    listeners.get(type)?.({
      clientX: x,
      clientY: y,
      deltaY: 0,
      preventDefault: () => undefined,
    } as never);
  };
  return Object.assign(withDom, {
    pointerMove: (x: number, y: number) => emit('mousemove', x, y),
    pointerDown: (x: number, y: number) => emit('mousedown', x, y),
    pointerUp: (x: number, y: number) => emit('mouseup', x, y),
  });
}

function makeApp(storage = new MemoryStorageBackend()): {
  app: GameApp;
  canvas: ReturnType<typeof makeCanvas>;
} {
  const canvas = makeCanvas();
  const app = new GameApp({ storage, width: WIDTH, height: HEIGHT });
  app.attach(canvas);
  return { app, canvas };
}

function click(canvas: ReturnType<typeof makeCanvas>, app: GameApp, x: number, y: number): void {
  canvas.pointerMove(x, y);
  canvas.pointerDown(x, y);
  canvas.pointerUp(x, y);
  app.frame();
}

/** Клик по контролу по его id: тест не должен знать координат раскладки меню. */
function clickControl(canvas: ReturnType<typeof makeCanvas>, app: GameApp, id: string): void {
  const target = controlCenter(app, id);
  expect(target, `контрол ${id} не отрисован`).not.toBeNull();
  click(canvas, app, target!.x, target!.y);
}

/** Ищет центр контрола по его id через список, собранный при последней отрисовке. */
function controlCenter(app: GameApp, id: string): { x: number; y: number } | null {
  const ui = (
    app as unknown as {
      ui: {
        controls: readonly {
          id: string;
          rect: { x: number; y: number; width: number; height: number };
        }[];
      } | null;
    }
  ).ui;
  const control = ui?.controls.find((c) => c.id === id);
  if (!control) return null;
  return {
    x: control.rect.x + control.rect.width / 2,
    y: control.rect.y + control.rect.height / 2,
  };
}

describe('главное меню', () => {
  it('стартует в главном меню и рисует экран без ошибок', async () => {
    const { app } = makeApp();
    await app.start();
    expect(app.states.state).toBe(GameState.MainMenu);

    const frames: string[] = [];
    app.events.on('state:changed', ({ to }) => frames.push(to));
    expect(() => app.advance(3)).not.toThrow();
    expect(frames).toEqual([]);
  });

  it('показывает кнопку выбора уровня и переходит на экран уровней', async () => {
    const { app, canvas } = makeApp();
    await app.start();
    app.frame();

    clickControl(canvas, app, 'menu_levels');
    expect(app.states.state).toBe(GameState.LevelSelect);
  });

  it('печатает по одной карточке на каждый зарегистрированный уровень', async () => {
    const { app } = makeApp();
    await app.start();
    app.openLevelSelectForTest();
    app.frame();

    expect(app.levelCards().length).toBe(app.levelManager.levelIds.length);
    for (const card of app.levelCards()) {
      expect(controlCenter(app, `level_card:${card.id}`)).not.toBeNull();
    }
  });

  it('выходит в настройки и обратно', async () => {
    const { app, canvas } = makeApp();
    await app.start();
    app.frame();

    clickControl(canvas, app, 'menu_settings');
    expect(app.states.state).toBe(GameState.Settings);

    app.frame();
    clickControl(canvas, app, 'settings_back');
    expect(app.states.state).toBe(GameState.MainMenu);
  });
});

describe('выбор уровня', () => {
  it('клик по карточке запускает уровень', async () => {
    const { app, canvas } = makeApp();
    await app.start();
    clickControl(canvas, app, 'menu_levels');
    expect(app.states.state).toBe(GameState.LevelSelect);
    app.frame();

    clickControl(canvas, app, `level_card:${app.levelManager.defaultLevelId}`);
    await waitForPlaying(app);
    expect(app.states.state).toBe(GameState.Playing);
    expect(app.currentSession?.level.id).toBe(app.levelManager.defaultLevelId);
  });

  it('клавиатура листает карточки циклически и подтверждает выбор', async () => {
    const { app } = makeApp();
    await app.start();
    app.openLevelSelectForTest();
    expect(app.states.state).toBe(GameState.LevelSelect);
    app.frame();

    const count = app.levelManager.levelIds.length;
    const selectedIndex = (): number =>
      (app as unknown as { levelSelect: { selectedIndex: number } }).levelSelect.selectedIndex;
    const startIndex = selectedIndex();

    app.input.press('navigateUp');
    app.frame();
    if (count > 1) expect(selectedIndex()).toBe((startIndex - 1 + count) % count);

    app.input.press('navigateDown');
    app.frame();
    expect(selectedIndex()).toBe(startIndex);

    app.input.press('confirm');
    app.frame();
    await waitForPlaying(app);
    expect(app.states.state).toBe(GameState.Playing);
  });

  it('Esc возвращает в главное меню', async () => {
    const { app } = makeApp();
    await app.start();
    app.openLevelSelectForTest();

    app.input.press('pause');
    app.frame();
    expect(app.states.state).toBe(GameState.MainMenu);
  });

  it('назад из уровня возвращает в меню, а не в выбор уровня', async () => {
    const { app } = makeApp();
    await app.start();
    await app.startLevel();

    app.exitToMenu();
    expect(app.states.state).toBe(GameState.MainMenu);
    expect(app.currentSession).toBeNull();
  });
});

describe('переход в игру', () => {
  it('после старта уровня тикает и рисует сцену', async () => {
    const { app } = makeApp();
    await app.start();
    await app.startLevel();
    expect(app.states.state).toBe(GameState.Playing);

    expect(() => app.advance(30)).not.toThrow();
    expect(app.currentSession?.elapsedSeconds).toBeGreaterThan(0);
  });

  it('пауза и возобновление не ломают состояние', async () => {
    const { app, canvas } = makeApp();
    await app.start();
    await app.startLevel();
    app.frame();

    app.pauseGame();
    app.frame();
    expect(app.states.state).toBe(GameState.Paused);

    clickControl(canvas, app, 'pause_resume');
    expect(app.states.state).toBe(GameState.Playing);
  });

  it('рестарт пересоздаёт сессию того же уровня', async () => {
    const { app } = makeApp();
    await app.start();
    await app.startLevel();
    const first = app.currentSession;

    await app.restartLevel();
    expect(app.states.state).toBe(GameState.Playing);
    expect(app.currentSession).not.toBe(first);
    expect(app.currentSession?.level.id).toBe(first?.level.id);
  });

  it('продолжение из меню возвращает на последний сыгранный уровень', async () => {
    const { app } = makeApp();
    await app.start();
    await app.startLevel();
    const levelId = app.currentSession?.level.id;
    app.exitToMenu();
    app.frame();

    app.input.press('confirm');
    app.advance(1);
    await waitForPlaying(app);
    expect(app.states.state).toBe(GameState.Playing);
    expect(app.currentSession?.level.id).toBe(levelId);
  });
});

describe('сохранение прогресса', () => {
  it('меню показывает рекорд после победы', async () => {
    const storage = seededStorage({
      completed: true,
      bestScore: 2666,
      bestRank: 'Perfect Demolition',
      minimumShots: 2,
      bestGeneratorHealth: 0.99,
      attempts: 3,
      lastPlayedAt: 1,
    });
    const { app } = makeApp(storage);
    await app.start();
    app.frame();

    const model = app.menuModel();
    expect(model.bestScore).toBe(2666);
    expect(model.bestRank).toBe('Perfect Demolition');
    expect(model.levelCompleted).toBe(true);
    expect(model.completedLevelCount).toBe(1);
    expect(model.levelCount).toBe(app.levelManager.levelIds.length);
  });

  it('неизвестный ранг из сохранения не ломает карточки уровня', async () => {
    const { app } = makeApp(
      seededStorage({
        completed: true,
        bestScore: 10,
        bestRank: 'Взлом',
        minimumShots: null,
        bestGeneratorHealth: 1,
        attempts: 1,
        lastPlayedAt: 1,
      }),
    );
    await app.start();
    app.openLevelSelectForTest();
    app.frame();

    expect(app.levelCards()[0].bestRank).toBe('Нет результата');
  });

  it('прогресс из сохранения открывает «Продолжить» без прошлой сессии', async () => {
    const storage = seededStorage({
      completed: true,
      bestScore: 2666,
      bestRank: 'Perfect Demolition',
      minimumShots: 2,
      bestGeneratorHealth: 0.99,
      attempts: 3,
      lastPlayedAt: 1,
    });
    const { app } = makeApp(storage);
    await app.start();
    app.frame();

    expect(app.menuModel().canResume).toBe(true);
    app.input.press('confirm');
    app.advance(1);
    await waitForPlaying(app);
    expect(app.states.state).toBe(GameState.Playing);
    expect(app.currentSession?.level.id).toBe(app.levelManager.defaultLevelId);
  });

  it('неизвестный ранг из сохранения не ломает меню', async () => {
    const { app } = makeApp(
      seededStorage({
        completed: true,
        bestScore: 10,
        bestRank: 'Взлом',
        minimumShots: null,
        bestGeneratorHealth: 1,
        attempts: 1,
        lastPlayedAt: 1,
      }),
    );
    await app.start();
    app.frame();

    expect(app.menuModel().bestRank).toBe('Нет результата');
  });
});

/** Сохранение с одной завершённой записью: id уровня берётся из реестра по умолчанию. */
function seededStorage(record: LevelRecord): MemoryStorageBackend {
  const storage = new MemoryStorageBackend();
  storage.write(
    SAVE_KEY,
    JSON.stringify({
      version: 1,
      settings: DEFAULT_SETTINGS satisfies SaveSettings,
      levels: { water_tower_01: record },
    }),
  );
  return storage;
}
