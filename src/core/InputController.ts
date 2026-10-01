export type InputAction =
  | 'restart'
  | 'pause'
  | 'slowMotion'
  | 'toggleTrajectory'
  | 'toggleAnalysis'
  | 'debugOverlay'
  | 'confirm'
  | 'escape'
  | 'navigateUp'
  | 'navigateDown';

export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly isDown: boolean;
  readonly justPressed: boolean;
  readonly justReleased: boolean;
  readonly clickX: number;
  readonly clickY: number;
}

export interface InputSnapshot {
  readonly pointer: PointerState;
  readonly actions: Readonly<Record<InputAction, boolean>>;
  readonly slowMotionHeld: boolean;
}

export interface InputSource {
  addKeyDown(handler: (code: string, event: KeyboardEventLike) => void): void;
  addKeyUp(handler: (code: string, event: KeyboardEventLike) => void): void;
  addPointerDown(handler: (x: number, y: number) => void): void;
  addPointerMove(handler: (x: number, y: number) => void): void;
  addPointerUp(handler: (x: number, y: number) => void): void;
}

export interface KeyboardEventLike {
  preventDefault?(): void;
}

/**
 * Ввод мышью и клавиатурой. Знает только о кодах клавиш и экранных координатах;
 * игровую интерпретацию (угол/сила) делает уровень.
 */
export class InputController {
  private pointerX = 0;
  private pointerY = 0;
  private down = false;
  private pressedThisFrame = false;
  private releasedThisFrame = false;
  private pressX = 0;
  private pressY = 0;
  private readonly held = new Set<InputAction>();
  private readonly frameActions = new Set<InputAction>();
  private readonly pressedKeys = new Set<string>();

  private attachGeneration = 0;

  /**
   * Подписка на источник ввода. Возвращает функцию отписки.
   *
   * Источник не умеет снимать обработчики, поэтому отписка работает через
   * поколение подписки: старые обработчики просто перестают влиять на ввод.
   * Это также защищает от двойного подключения, если attach вызвали повторно.
   */
  attach(source: InputSource): () => void {
    const generation = ++this.attachGeneration;
    const live = (): boolean => generation === this.attachGeneration;

    source.addKeyDown((code, event) => {
      if (live()) this.pressKey(code, event);
    });
    source.addKeyUp((code, event) => {
      if (live()) this.releaseKey(code, event);
    });
    source.addPointerDown((x, y) => {
      if (live()) this.pointerDown(x, y);
    });
    source.addPointerMove((x, y) => {
      if (live()) this.pointerMove(x, y);
    });
    source.addPointerUp((x, y) => {
      if (live()) this.pointerUp(x, y);
    });

    return () => {
      if (!live()) return;
      this.attachGeneration++;
      this.reset();
    };
  }

  /** Нажатие клавиши. Повтор клавиши игнорируется. */
  pressKey(code: string, event?: KeyboardEventLike): void {
    event?.preventDefault?.();
    if (this.pressedKeys.has(code)) return;
    this.pressedKeys.add(code);
    const action = KEY_MAP[code];
    if (!action) return;
    this.held.add(action);
    this.frameActions.add(action);
  }

  /** Отпускание клавиши. */
  releaseKey(code: string, event?: KeyboardEventLike): void {
    event?.preventDefault?.();
    this.pressedKeys.delete(code);
    const action = KEY_MAP[code];
    if (action) this.held.delete(action);
  }

  pointerDown(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
    this.pressX = x;
    this.pressY = y;
    this.down = true;
    this.pressedThisFrame = true;
  }

  pointerMove(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
  }

  pointerUp(x: number, y: number): void {
    this.pointerX = x;
    this.pointerY = y;
    this.down = false;
    this.releasedThisFrame = true;
  }

  get pointer(): PointerState {
    return {
      x: this.pointerX,
      y: this.pointerY,
      isDown: this.down,
      justPressed: this.pressedThisFrame,
      justReleased: this.releasedThisFrame,
      clickX: this.pressX,
      clickY: this.pressY,
    };
  }

  get slowMotionHeld(): boolean {
    return this.held.has('slowMotion');
  }

  /**
   * Имитация действия без клавиатуры. Нужна headless-проверкам меню и паузе:
   * привязать реальные события окна вне браузера нельзя.
   */
  press(action: InputAction): void {
    this.held.add(action);
    this.frameActions.add(action);
  }

  /** Действия, сработавшие в этом кадре. */
  consumeActions(): InputAction[] {
    const out = [...this.frameActions];
    this.frameActions.clear();
    return out;
  }

  isHeld(action: InputAction): boolean {
    return this.held.has(action);
  }

  isKeyDown(code: string): boolean {
    return this.pressedKeys.has(code);
  }

  /** Вызывается в конце кадра. */
  endFrame(): void {
    this.pressedThisFrame = false;
    this.releasedThisFrame = false;
    this.pressedKeys.clear();
  }

  /** Сброс при паузе: снимает удержание, чтобы возобновление не «выстрелило». */
  reset(): void {
    this.down = false;
    this.pressedThisFrame = false;
    this.releasedThisFrame = false;
    this.held.clear();
    this.frameActions.clear();
    this.pressedKeys.clear();
  }

  snapshot(): InputSnapshot {
    const actions = {} as Record<InputAction, boolean>;
    for (const action of Object.values(KEY_MAP)) actions[action] = this.held.has(action);
    return { pointer: this.pointer, actions, slowMotionHeld: this.slowMotionHeld };
  }
}

export const KEY_MAP: Readonly<Record<string, InputAction>> = {
  KeyR: 'restart',
  Escape: 'pause',
  Space: 'slowMotion',
  KeyT: 'toggleTrajectory',
  KeyV: 'toggleAnalysis',
  F1: 'debugOverlay',
  Enter: 'confirm',
  ArrowUp: 'navigateUp',
  KeyW: 'navigateUp',
  ArrowDown: 'navigateDown',
  KeyS: 'navigateDown',
};

/** Действия, требующие удержания клавиши (медленное время). */
export const HOLD_ACTIONS: ReadonlySet<InputAction> = new Set<InputAction>(['slowMotion']);
