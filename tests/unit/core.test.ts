import { describe, expect, it } from 'vitest';

import { EventBus } from '../../src/core/EventBus';
import type { GameEvents } from '../../src/core/GameEvents';
import {
  InputController,
  type InputSource,
  type KeyboardEventLike,
} from '../../src/core/InputController';
import {
  MemoryStorageBackend,
  SAVE_KEY,
  SaveManager,
  emptySaveData,
  migrateSaveData,
} from '../../src/core/SaveManager';
import {
  GameState,
  GameStateManager,
  InvalidStateTransitionError,
} from '../../src/core/GameStateManager';

function silentBus(): EventBus<GameEvents> {
  return new EventBus<GameEvents>();
}

describe('EventBus', () => {
  it('доставляет события подписчикам и поддерживает отписку', () => {
    const bus = new EventBus<{ ping: { value: number } }>();
    const seen: number[] = [];
    const off = bus.on('ping', ({ value }) => seen.push(value));

    bus.emit('ping', { value: 1 });
    off();
    bus.emit('ping', { value: 2 });

    expect(seen).toEqual([1]);
  });

  it('once срабатывает один раз', () => {
    const bus = new EventBus<{ tick: undefined }>();
    let calls = 0;
    bus.once('tick', () => (calls += 1));
    bus.emit('tick', undefined);
    bus.emit('tick', undefined);
    expect(calls).toBe(1);
  });

  it('ошибка подписчика не ломает остальных', () => {
    const bus = new EventBus<{ tick: undefined }>();
    const seen: number[] = [];
    bus.on('tick', () => {
      throw new Error('boom');
    });
    bus.on('tick', () => seen.push(1));

    expect(() => bus.emit('tick', undefined)).not.toThrow();
    expect(seen).toEqual([1]);
  });
});

describe('GameStateManager', () => {
  it('разрешает только объявленные переходы', () => {
    const states = new GameStateManager(GameState.MainMenu);
    expect(states.canTransitionTo(GameState.Playing)).toBe(true);
    expect(states.canTransitionTo(GameState.Result)).toBe(false);
    expect(() => states.transitionTo(GameState.Result)).toThrow(InvalidStateTransitionError);
    expect(states.tryTransitionTo(GameState.Result)).toBe(false);
  });

  it('ведёт историю и уведомляет подписчиков', () => {
    const states = new GameStateManager(GameState.MainMenu);
    const seen: string[] = [];
    const off = states.subscribe(({ from, to }) => seen.push(`${from}->${to}`));

    states.transitionTo(GameState.Playing);
    states.transitionTo(GameState.Paused);
    off();
    states.transitionTo(GameState.Result);

    expect(seen).toEqual([
      `${GameState.MainMenu}->${GameState.Playing}`,
      `${GameState.Playing}->${GameState.Paused}`,
    ]);
    expect(states.state).toBe(GameState.Result);
    expect(states.getPreviousState()).toBe(GameState.Paused);
    expect(states.getStatePath()).toHaveLength(4);
  });
});

describe('InputController', () => {
  it('классифицирует клавиши в действия и игнорирует автоповтор', () => {
    const input = new InputController();
    input.pressKey('KeyR');
    input.pressKey('KeyR');

    expect(input.isKeyDown('KeyR')).toBe(true);
    expect(input.consumeActions()).toContain('restart');
    expect(input.consumeActions()).toEqual([]);
  });

  it('различает нажатие, движение и отпускание указателя', () => {
    const input = new InputController();
    input.pointerDown(100, 200);
    expect(input.pointer).toMatchObject({
      x: 100,
      y: 200,
      isDown: true,
      justPressed: true,
      clickX: 100,
      clickY: 200,
    });

    input.pointerMove(150, 250);
    expect(input.pointer.x).toBe(150);

    input.pointerUp(150, 250);
    expect(input.pointer.isDown).toBe(false);
    expect(input.pointer.justReleased).toBe(true);
  });

  it('endFrame снимает состояния «в этом кадре», но не удержание', () => {
    const input = new InputController();
    input.pressKey('Space');
    input.pointerDown(1, 1);
    input.endFrame();

    expect(input.pointer.justPressed).toBe(false);
    expect(input.isKeyDown('Space')).toBe(false);
    expect(input.slowMotionHeld).toBe(true);
  });

  it('attach подключает внешний источник и отключается по возвращённой функции', () => {
    const input = new InputController();
    const captured: {
      keyDown?: (code: string, event: KeyboardEventLike) => void;
    } = {};
    const source: InputSource = {
      addKeyDown: (cb) => {
        captured.keyDown = cb;
      },
      addKeyUp: () => undefined,
      addPointerDown: () => undefined,
      addPointerMove: () => undefined,
      addPointerUp: () => undefined,
    };

    const detach = input.attach(source);
    captured.keyDown?.('Escape', {});
    expect(input.consumeActions()).toEqual(['pause']);

    detach();
    captured.keyDown?.('Escape', {});
    expect(input.consumeActions()).toEqual([]);
  });

  it('reset снимает всё состояние', () => {
    const input = new InputController();
    input.pressKey('Space');
    input.pointerDown(10, 10);
    input.reset();

    expect(input.slowMotionHeld).toBe(false);
    expect(input.pointer.isDown).toBe(false);
    expect(input.consumeActions()).toEqual([]);
  });
});

describe('SaveManager', () => {
  it('создаёт настройки по умолчанию при пустом хранилище', () => {
    const save = new SaveManager(silentBus(), new MemoryStorageBackend());
    expect(save.currentSettings.particleQuality).toBe('high');
    expect(save.hasCompleted('water_tower_01')).toBe(false);
  });

  it('сохраняет и восстанавливает настройки', () => {
    const storage = new MemoryStorageBackend();
    new SaveManager(silentBus(), storage).updateSettings({ sfxVolume: 0.25, debugMode: true });

    const restored = new SaveManager(silentBus(), storage);
    expect(restored.currentSettings.sfxVolume).toBe(0.25);
    expect(restored.currentSettings.debugMode).toBe(true);
  });

  it('публикует событие изменения настроек', () => {
    const bus = silentBus();
    const save = new SaveManager(bus, new MemoryStorageBackend());
    let seen: { sfxVolume?: number } | null = null;
    bus.on('settings:changed', (patch) => {
      seen = patch;
    });

    save.updateSettings({ sfxVolume: 0.1 });
    expect(seen).toEqual({ sfxVolume: 0.1 });
  });

  it('хранит лучший результат уровня и считает попытки', () => {
    const save = new SaveManager(silentBus(), new MemoryStorageBackend());
    save.recordResult('water_tower_01', {
      completed: true,
      score: 1500,
      rank: 'Gold',
      shotsUsed: 2,
      generatorHealthRatio: 0.95,
    });
    const second = save.recordResult('water_tower_01', {
      completed: false,
      score: 900,
      rank: 'Silver',
      shotsUsed: 3,
      generatorHealthRatio: 0.8,
    });

    expect(second.bestScore).toBe(1500);
    expect(second.bestRank).toBe('Gold');
    expect(second.minimumShots).toBe(2);
    expect(second.attempts).toBe(2);
    expect(second.bestGeneratorHealth).toBeCloseTo(0.95, 6);
    expect(save.hasCompleted('water_tower_01')).toBe(true);
  });

  it('не падает на повреждённых данных и чинит значения', () => {
    const storage = new MemoryStorageBackend();
    storage.write(SAVE_KEY, '{ это не json');
    const save = new SaveManager(silentBus(), storage);
    expect(save.currentSettings.sfxVolume).toBeGreaterThan(0);

    const fixed = migrateSaveData({ settings: { sfxVolume: 9, particleQuality: 'ultra' } });
    expect(fixed.settings.sfxVolume).toBe(1);
    expect(fixed.settings.particleQuality).toBe('high');
  });

  it('resetProgress стирает рекорды, но сохраняет настройки', () => {
    const save = new SaveManager(silentBus(), new MemoryStorageBackend());
    save.updateSettings({ musicVolume: 0.2 });
    save.recordResult('a', {
      completed: true,
      score: 100,
      rank: 'Bronze',
      shotsUsed: 3,
      generatorHealthRatio: 0.7,
    });

    save.resetProgress();
    expect(save.getLevelRecord('a')).toBeNull();
    expect(save.currentSettings.musicVolume).toBe(0.2);
    expect(save.raw.levels).toEqual({});
    expect(emptySaveData().levels).toEqual({});
  });
});
