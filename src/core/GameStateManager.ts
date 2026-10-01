/** Состояния приложения и переходы между ними. */

export const GameState = {
  Boot: 'boot',
  MainMenu: 'main_menu',
  Settings: 'settings',
  Playing: 'playing',
  Paused: 'paused',
  Result: 'result',
} as const;

export type GameStateName = (typeof GameState)[keyof typeof GameState];

/** Разрешённые переходы. Любой другой переход игнорируется с предупреждением. */
const TRANSITIONS: Record<GameStateName, readonly GameStateName[]> = {
  [GameState.Boot]: [GameState.MainMenu],
  [GameState.MainMenu]: [GameState.Settings, GameState.Playing, GameState.Boot],
  [GameState.Settings]: [GameState.MainMenu, GameState.Boot],
  [GameState.Playing]: [GameState.Paused, GameState.Result, GameState.MainMenu, GameState.Settings],
  [GameState.Paused]: [GameState.Playing, GameState.MainMenu, GameState.Result],
  [GameState.Result]: [GameState.Playing, GameState.MainMenu, GameState.Settings],
};

export class InvalidStateTransitionError extends Error {
  constructor(
    readonly from: GameStateName,
    readonly to: GameStateName,
  ) {
    super(`Недопустимый переход состояния: ${from} -> ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export interface StateChangePayload {
  from: GameStateName;
  to: GameStateName;
}

/**
 * Хранит текущее состояние приложения, валидирует переходы и уведомляет подписчиков.
 * Логика состояний полностью отделена от рендера и физики.
 */
export class GameStateManager {
  private currentState: GameStateName;
  private readonly history: GameStateName[] = [];
  private readonly listeners = new Set<(payload: StateChangePayload) => void>();

  constructor(initialState: GameStateName = GameState.Boot) {
    this.currentState = initialState;
    this.history.push(initialState);
  }

  get state(): GameStateName {
    return this.currentState;
  }

  get historyDepth(): number {
    return this.history.length;
  }

  getPreviousState(): GameStateName | null {
    return this.history.length > 1 ? this.history[this.history.length - 2] : null;
  }

  is(...states: GameStateName[]): boolean {
    return states.includes(this.currentState);
  }

  canTransitionTo(target: GameStateName): boolean {
    if (target === this.currentState) return true;
    return TRANSITIONS[this.currentState].includes(target);
  }

  /** Бросает {@link InvalidStateTransitionError}, если переход запрещён. */
  transitionTo(target: GameStateName): StateChangePayload {
    if (target === this.currentState) {
      return { from: this.currentState, to: this.currentState };
    }
    if (!this.canTransitionTo(target)) {
      throw new InvalidStateTransitionError(this.currentState, target);
    }
    const payload: StateChangePayload = { from: this.currentState, to: target };
    this.currentState = target;
    this.history.push(target);
    if (this.history.length > 32) this.history.shift();
    for (const listener of [...this.listeners]) listener(payload);
    return payload;
  }

  /** Мягкий переход: возвращает false вместо исключения. */
  tryTransitionTo(target: GameStateName): boolean {
    if (!this.canTransitionTo(target)) return false;
    this.transitionTo(target);
    return true;
  }

  subscribe(listener: (payload: StateChangePayload) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatePath(): readonly GameStateName[] {
    return this.history;
  }
}
