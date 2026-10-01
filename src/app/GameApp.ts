import { AudioManager } from '../audio/AudioManager';
import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import { GameState, GameStateManager } from '../core/GameStateManager';
import { InputController } from '../core/InputController';
import {
  SaveManager,
  createDefaultStorage,
  type SaveSettings,
  type StorageBackend,
} from '../core/SaveManager';
import { validateLevel, type LevelDefinition } from '../data/LevelData';
import { GameSession, type SessionResult } from '../gameplay/GameSession';
import type { ScoringSystem } from '../gameplay/ScoringSystem';
import { LevelManager } from '../levels/LevelManager';
import { CameraController } from '../render/CameraController';
import { DebugOverlay } from '../render/DebugOverlay';
import { EffectSystem, type QualityLevel } from '../render/EffectSystem';
import { SceneRenderer } from '../render/SceneRenderer';
import { TrajectoryRenderer } from '../render/TrajectoryRenderer';
import { UiCanvas } from '../ui/UiCanvas';
import {
  HudController,
  MainMenuController,
  PauseController,
  ResultController,
  SettingsController,
} from '../ui/Controllers';

export const GAME_VERSION = '0.1.0';

const CONTROLS_HINT = [
  'ЛКМ — прицел и запуск',
  'R — рестарт',
  'Esc — пауза',
  'Space — замедление',
  'T — траектория',
  'V — анализ',
  'F1 — отладка',
];

/** Замедление времени при удержании Space. */
const SLOW_MOTION_SCALE = 0.3;
/** Длительность замедления после отпускания. */
const SLOW_MOTION_LINGER = 0.45;

/**
 * Точка сборки приложения: связывает состояние, сессию уровня, ввод и рендер.
 * Вся игровая логика живёт в отдельных системах; этот класс только оркестрирует.
 */
export class GameApp {
  readonly events = new EventBus<GameEvents>();
  readonly states = new GameStateManager(GameState.Boot);
  readonly input: InputController;
  readonly save: SaveManager;
  readonly audio: AudioManager;
  readonly levelManager = new LevelManager();
  debug: DebugOverlay;

  private session: GameSession | null = null;
  private camera: CameraController | null = null;
  private effects: EffectSystem | null = null;
  private scene: SceneRenderer | null = null;
  private trajectory: TrajectoryRenderer | null = null;
  private ui: UiCanvas | null = null;

  private hud: HudController | null = null;
  private pause: PauseController | null = null;
  private result: ResultController | null = null;
  private menu: MainMenuController | null = null;
  private settingsScreen: SettingsController | null = null;

  private slowMotionTimer = 0;
  private lastFrameTime = 0;
  private rafHandle: number | null = null;
  private running = false;
  private pendingLevelResult: SessionResult | null = null;
  private trajectoryVisible = true;
  private notice: { text: string; severity: string; until: number } | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private detachInput: (() => void) | null = null;
  private sessionCleanup: Array<() => void> = [];

  constructor(options: { storage?: StorageBackend; width?: number; height?: number } = {}) {
    this.input = new InputController();
    this.save = new SaveManager(this.events, options.storage ?? createDefaultStorage());
    this.audio = new AudioManager(this.events, this.save.currentSettings);
    this.debug = new DebugOverlay(options.width ?? 1280);

    const settings = this.save.currentSettings;
    this.trajectoryVisible = settings.showTrajectory;
    this.debug.setVisible(settings.debugMode);

    this.buildUi();
    this.wireEvents();
  }

  // ───────────────────────────── инициализация ─────────────────────────────

  private buildUi(): void {
    const ui = new UiCanvas();
    this.ui = ui;

    this.hud = new HudController(ui, {
      onPause: () => this.pauseGame(),
      onRestart: () => void this.restartLevel(),
      onToggleAnalysis: () => this.toggleAnalysis(),
      onToggleTrajectory: () => this.toggleTrajectory(),
    });

    this.pause = new PauseController(ui, {
      onResume: () => this.resumeGame(),
      onRestart: () => void this.restartLevel(),
      onMenu: () => this.exitToMenu(),
      onSettings: () => this.states.transitionTo(GameState.Settings),
    });

    this.result = new ResultController(ui, {
      onRetry: () => void this.restartLevel(),
      onMenu: () => this.exitToMenu(),
    });

    this.menu = new MainMenuController(ui, {
      onStart: () => void this.startLevel(),
      onSettings: () => this.states.transitionTo(GameState.Settings),
      onExit: () => this.exitApp(),
    });

    this.settingsScreen = new SettingsController(ui, {
      onBack: () => this.closeSettings(),
      onChange: (patch) => this.applySettings(patch),
      onResetProgress: () => this.resetProgress(),
    });
  }

  private wireEvents(): void {
    this.states.subscribe(({ to }) => {
      this.events.emit('state:changed', { from: to, to });
      if (to === GameState.Playing) this.audio.attachBrowserContext();
      if (to === GameState.MainMenu || to === GameState.Settings) this.audio.startMusic();
    });

    this.events.on('notice', ({ text, severity }) => {
      this.notice = { text, severity, until: performance.now() + 2600 };
    });

    this.events.on('level:completed', () => {
      if (this.session?.result) this.pendingLevelResult = this.session.result;
    });

    this.events.on('debug:toggle', ({ overlay }) => this.debug.setVisible(overlay));
    this.events.on('analysis:toggle', ({ active }) => {
      if (!active && this.session?.analysis.isActive) this.session.analysis.setActive(false);
    });
  }

  /** Привязка к canvas и DOM-событиям. */
  attach(canvas: HTMLCanvasElement): () => void {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('Не удалось получить 2D-контекст canvas');
    this.resize();

    const toLocal = (event: MouseEvent): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      return [
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
        ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
      ];
    };

    const onMove = (event: MouseEvent): void => this.inputPointerMove(...toLocal(event));
    const onDown = (event: MouseEvent): void => this.inputPointerDown(...toLocal(event));
    const onUp = (event: MouseEvent): void => this.inputPointerUp(...toLocal(event));
    const onLeave = (): void => this.ui?.clearHover();
    const onWheel = (event: WheelEvent): void => {
      if (this.states.state !== GameState.Playing) return;
      event.preventDefault();
      this.camera?.addZoom(event.deltaY > 0 ? -0.08 : 0.08);
    };
    const onKeyDown = (event: KeyboardEvent): void => this.input.pressKey(event.code, event);
    const onKeyUp = (event: KeyboardEvent): void => this.input.releaseKey(event.code, event);
    const onResize = (): void => this.resize();

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);

    this.detachInput?.();
    this.detachInput = () => {
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      this.input.reset();
    };

    return this.detachInput;
  }

  /** Программная имитация ввода: те же пути, что и у мыши. */
  private inputPointerDown(x: number, y: number): void {
    this.ui?.handlePointerMove(x, y);
    this.input.pointerDown(x, y);
    this.handleUiPointerDown(x, y);
  }

  private inputPointerMove(x: number, y: number): void {
    this.ui?.handlePointerMove(x, y);
    this.input.pointerMove(x, y);
    this.handleUiPointerMove(x, y);
  }

  private inputPointerUp(x: number, y: number): void {
    this.ui?.handlePointerMove(x, y);
    this.input.pointerUp(x, y);
    this.handleUiPointerUp(x, y);
  }

  private resize(): void {
    if (!this.canvas) return;
    const width = Math.min(1600, Math.max(960, window.innerWidth));
    const height = Math.min(900, Math.max(540, window.innerHeight));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.camera?.setViewport({ width: this.canvas.width, height: this.canvas.height });
    this.debug = new DebugOverlay(this.canvas.width);
  }

  // ───────────────────────────── жизненный цикл ─────────────────────────────

  async start(levelId?: string): Promise<void> {
    this.states.transitionTo(GameState.MainMenu);
    if (!this.running) {
      this.running = true;
      this.loop(0);
    }
    if (levelId) await this.startLevel(levelId);
  }

  async startLevel(levelId?: string): Promise<void> {
    const id = levelId ?? this.levelManager.defaultLevelId;
    const level = await this.levelManager.load(id);
    validateLevel(level);
    this.createSession(level);
    this.states.transitionTo(GameState.Playing);
    this.events.emit('level:loaded', { levelId: id });
  }

  private createSession(level: LevelDefinition): void {
    this.disposeSession();

    const canvas = this.canvas;
    const width = canvas?.width ?? 1280;
    const height = canvas?.height ?? 720;

    this.effects = new EffectSystem(
      (this.save.currentSettings.particleQuality as QualityLevel) ?? 'high',
      level.environment.gravity,
    );
    this.camera = new CameraController(
      {
        centerX: level.camera?.centerX ?? level.launcher.x + 14,
        centerY: level.camera?.centerY ?? 8,
        zoom: level.camera?.zoom ?? 1,
      },
      { width, height },
    );
    this.scene = new SceneRenderer(this.camera);
    this.trajectory = new TrajectoryRenderer(this.camera);

    const session = new GameSession(level, this.events, this.audio, this.effects, this.camera);
    this.session = session;

    this.sessionCleanup.push(
      this.events.on('projectile:impact', ({ x, y }) => this.debug.registerContact(x, y)),
    );
    this.sessionCleanup.push(
      this.events.on('connection:broken', () => this.debug.registerContact(0, 0)),
    );
    this.sessionCleanup.push(
      this.events.on('debug:toggle', ({ overlay }) => this.debug.setVisible(overlay)),
    );

    this.debug.setVisible(this.save.currentSettings.debugMode);
    this.camera.setViewport({ width, height });
  }

  private disposeSession(): void {
    for (const off of this.sessionCleanup) off();
    this.sessionCleanup = [];
    this.session?.destroy();
    this.session = null;
    this.effects?.clear();
  }

  async restartLevel(): Promise<void> {
    const id = this.session?.level.id ?? this.levelManager.defaultLevelId;
    const level = await this.levelManager.load(id);
    this.createSession(level);
    this.pendingLevelResult = null;
    this.notice = null;
    if (!this.states.is(GameState.Playing)) this.states.transitionTo(GameState.Playing);
    this.events.emit('level:restarted', { levelId: id });
  }

  pauseGame(): void {
    if (!this.states.is(GameState.Playing)) return;
    this.input.reset();
    this.session?.unlockAim();
    this.states.transitionTo(GameState.Paused);
  }

  resumeGame(): void {
    if (!this.states.is(GameState.Paused)) return;
    this.input.reset();
    this.states.transitionTo(GameState.Playing);
  }

  exitToMenu(): void {
    this.disposeSession();
    this.states.transitionTo(GameState.MainMenu);
  }

  closeSettings(): void {
    const previous = this.states.getPreviousState();
    const target = previous === GameState.Paused ? GameState.Paused : GameState.MainMenu;
    this.states.transitionTo(target);
  }

  exitApp(): void {
    this.running = false;
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.audio.stopMusic();
    this.save.save();
  }

  private applySettings(patch: Partial<SaveSettings>): void {
    const settings = this.save.updateSettings(patch);
    this.audio.setVolumes(settings.sfxVolume, settings.musicVolume);
    this.events.emit('audio:settings', { sfx: settings.sfxVolume, music: settings.musicVolume });
    this.trajectoryVisible = settings.showTrajectory;
    this.debug.setVisible(settings.debugMode);
    this.effects?.setQuality(settings.particleQuality as QualityLevel);
    this.audio.play('ui_click');

    if (settings.fullscreen) void this.requestFullscreen(true);
    else void this.requestFullscreen(false);
  }

  private async requestFullscreen(enabled: boolean): Promise<void> {
    try {
      if (enabled && !document.fullscreenElement)
        await document.documentElement.requestFullscreen();
      else if (!enabled && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* полноэкранный режим может быть недоступен */
    }
  }

  private resetProgress(): void {
    this.save.resetProgress();
    this.audio.play('ui_click');
    this.notice = { text: 'Прогресс сброшен', severity: 'info', until: performance.now() + 2000 };
  }

  toggleAnalysis(): void {
    if (!this.session) return;
    const active = this.session.analysis.toggle();
    this.events.emit('analysis:toggle', { active });
    this.audio.play('ui_click');
  }

  toggleTrajectory(): void {
    this.trajectoryVisible = !this.trajectoryVisible;
    this.events.emit('trajectory:toggle', { visible: this.trajectoryVisible });
    this.save.updateSettings({ showTrajectory: this.trajectoryVisible });
  }

  // ───────────────────────────── ввод ─────────────────────────────

  private handleActions(): void {
    const actions = this.input.consumeActions();
    const state = this.states.state;

    if (state === GameState.Result || state === GameState.Paused) {
      if (actions.includes('pause') || actions.includes('confirm')) this.resumeOrLeave();
      if (actions.includes('restart')) void this.restartLevel();
      if (actions.includes('confirm')) void this.restartLevel();
      return;
    }

    if (state === GameState.Settings) {
      if (actions.includes('pause') || actions.includes('confirm')) this.closeSettings();
      return;
    }

    if (state === GameState.MainMenu) {
      if (actions.includes('confirm')) void this.startLevel();
      return;
    }

    if (state !== GameState.Playing) return;

    if (actions.includes('pause')) this.pauseGame();
    if (actions.includes('restart')) void this.restartLevel();
    if (actions.includes('toggleTrajectory')) this.toggleTrajectory();
    if (actions.includes('toggleAnalysis')) this.toggleAnalysis();
    if (actions.includes('debugOverlay')) {
      const visible = this.debug.toggle();
      this.save.updateSettings({ debugMode: visible });
      this.events.emit('debug:toggle', { overlay: visible });
    }
  }

  private resumeOrLeave(): void {
    if (this.states.is(GameState.Paused)) this.resumeGame();
    else if (this.states.is(GameState.Result)) this.exitToMenu();
  }

  private handleUiPointerDown(x: number, y: number): void {
    const id = this.ui?.handlePointerDown(x, y) ?? null;
    if (id) this.audio.play('ui_hover', { volume: 0.4 });

    if (this.states.is(GameState.Playing) && !id && !this.session?.projectiles.active) {
      // ЛКМ в игре начинает прицеливание: фиксируем момент отпускания для силы.
      this.aiming = true;
    }
  }

  private aiming = false;

  private handleUiPointerMove(x: number, y: number): void {
    this.ui?.handleDrag(x);

    if (this.states.is(GameState.Playing) && this.session) {
      this.session.aimAtScreenPoint(x, y);
    }

    if (this.states.is(GameState.Settings)) {
      const ui = this.ui;
      const settings = this.save.currentSettings;
      if (!ui) return;

      const sfx = ui.getValue('settings_sfx');
      const music = ui.getValue('settings_music');
      if (sfx !== undefined || music !== undefined) {
        this.save.updateSettings({
          ...(sfx !== undefined ? { sfxVolume: sfx } : {}),
          ...(music !== undefined ? { musicVolume: music } : {}),
        });
        this.audio.setVolumes(
          this.save.currentSettings.sfxVolume,
          this.save.currentSettings.musicVolume,
        );
      }

      if (ui.isChecked('settings_debug') !== settings.debugMode) {
        this.applySettings({ debugMode: ui.isChecked('settings_debug') });
      }
      if (ui.isChecked('settings_trajectory') !== this.trajectoryVisible) {
        this.applySettings({ showTrajectory: ui.isChecked('settings_trajectory') });
      }
      if (ui.isChecked('settings_fullscreen') !== settings.fullscreen) {
        this.applySettings({ fullscreen: ui.isChecked('settings_fullscreen') });
      }
    }
  }

  private handleUiPointerUp(x: number, y: number): void {
    const id = this.ui?.handlePointerUp(x, y) ?? null;
    if (id) {
      this.audio.play('ui_click');
      this.dispatchUiClick(id);
      return;
    }

    if (this.states.is(GameState.Playing) && this.aiming) {
      this.aiming = false;
      if (this.session?.fire()) {
        /* запуск выполнен внутри сессии */
      }
    }
  }

  private dispatchUiClick(id: string): void {
    this.hud?.handleClick(id);
    this.pause?.handleClick(id);
    this.result?.handleClick(id);
    this.menu?.handleClick(id);
    this.settingsScreen?.handleClick(id);
  }

  // ───────────────────────────── главный цикл ─────────────────────────────

  private loop = (timestamp: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.loop);

    const now = timestamp || performance.now();
    if (this.lastFrameTime === 0) this.lastFrameTime = now;
    const frameMs = performance.now();
    let dt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    dt = Math.min(dt, 0.05);

    this.handleActions();
    this.tick(dt);
    this.debug.update(dt, performance.now() - frameMs);
    this.draw();
    this.input.endFrame();
  };

  /** Один тик логики. Публичный метод — используется headless-проверками. */
  tick(dt: number): void {
    const state = this.states.state;

    if (state === GameState.Playing) {
      this.tickPlaying(dt);
    } else if (state === GameState.Paused) {
      this.effects?.update(dt * 0.25);
      this.camera?.update(dt);
    } else if (state === GameState.Result) {
      this.effects?.update(dt);
      this.camera?.update(dt);
    } else {
      this.camera?.update(dt);
    }
  }

  private tickPlaying(dt: number): void {
    const session = this.session;
    if (!session) return;

    const slowHeld = this.input.slowMotionHeld;
    if (slowHeld) this.slowMotionTimer = SLOW_MOTION_LINGER;
    else if (this.slowMotionTimer > 0)
      this.slowMotionTimer = Math.max(0, this.slowMotionTimer - dt);
    const timeScale = this.slowMotionTimer > 0 ? SLOW_MOTION_SCALE : 1;

    session.step(dt, timeScale);

    if (session.projectiles.active) {
      const snap = session.projectiles.snapshot;
      if (snap) this.camera?.follow({ x: snap.x, y: snap.y });
    } else {
      this.camera?.moveTo(
        session.level.camera?.centerX ?? session.level.launcher.x + 14,
        session.level.camera?.centerY ?? 8,
      );
    }

    this.camera?.update(dt);
    this.debug.recordFrame(1, 6);

    if (session.sessionOutcome !== 'running') {
      this.finishLevel();
    }
  }

  private finishLevel(): void {
    const result = this.session?.result;
    if (!result) return;

    this.save.recordResult(this.session?.level.id ?? 'unknown', {
      completed: result.won,
      score: result.score,
      rank: result.rank,
      shotsUsed: result.shotsUsed,
      generatorHealthRatio: result.generatorHealthPercent / 100,
    });

    this.input.reset();
    this.states.transitionTo(GameState.Result);
  }

  // ───────────────────────────── отрисовка ─────────────────────────────

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const width = this.canvas?.width ?? 1280;
    const height = this.canvas?.height ?? 720;
    const state = this.states.state;

    ctx.clearRect(0, 0, width, height);

    switch (state) {
      case GameState.MainMenu:
        this.menu?.draw(ctx, width, height, this.menuModel());
        break;
      case GameState.Settings:
        this.settingsScreen?.draw(ctx, width, height, {
          settings: this.save.currentSettings,
          fullscreenSupported: typeof document !== 'undefined' && 'fullscreenEnabled' in document,
        });
        break;
      case GameState.Playing:
      case GameState.Paused:
        this.drawGameplay(ctx, width, height, state === GameState.Paused);
        break;
      case GameState.Result:
        this.drawResult(ctx, width, height);
        break;
      default:
        ctx.fillStyle = '#0d1116';
        ctx.fillRect(0, 0, width, height);
        break;
    }
  }

  private drawGameplay(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    paused: boolean,
  ): void {
    const session = this.session;
    const camera = this.camera;
    const scene = this.scene;
    if (!session || !camera || !scene) return;

    const debugData = this.debug.collectRenderData({
      graph: session.graph,
      zones: session.zones,
      objectives: session.objectives,
      scoring: session.scoring,
      analysis: session.analysis,
      ballistics: session.ballistics,
      physics: session.physics,
      projectiles: session.projectiles,
      effects: this.effects as EffectSystem,
      level: session.level,
      shotsUsed: session.shotsUsedCount,
      elapsedSeconds: session.elapsedSeconds,
      won: session.sessionOutcome === 'running' ? null : session.sessionOutcome === 'victory',
    });

    scene.render(ctx, {
      elements: session.elements,
      graph: session.graph,
      zones: session.zones.statuses(),
      projectile: session.projectiles.snapshot
        ? {
            x: session.projectiles.snapshot.x,
            y: session.projectiles.snapshot.y,
            radius: session.projectiles.snapshot.data.radius,
            trail: session.projectiles.trailPoints,
          }
        : null,
      effects: this.effects as EffectSystem,
      analysis: session.analysis.report,
      analysisActive: session.analysis.isActive,
      launcher: {
        x: session.ballistics.origin.x,
        y: session.ballistics.origin.y,
        angleDeg: session.ballistics.angleDeg,
        power: session.ballistics.power,
        ready: !session.projectiles.active && session.shotsRemaining > 0,
      },
      environment: session.level.environment,
      debug: this.debug.options,
      debugData,
      time: session.elapsedSeconds,
    });

    // Прогноз траектории рисуется поверх сцены.
    if (this.trajectory && this.effects) {
      const showTrajectory =
        this.trajectoryVisible && !session.projectiles.active && session.shotsRemaining > 0;
      const points = session.ballistics.predict({
        maxPoints: 110,
        pointInterval: 0.05,
        environment: session.level.environment,
      });
      this.trajectory.draw(ctx, points, {
        show: showTrajectory,
        power: session.ballistics.power,
        ready: session.shotsRemaining > 0,
        paused,
        aimX: session.ballistics.origin.x,
        aimY: session.ballistics.origin.y,
      });
      if (showTrajectory) this.trajectory.drawDirection(ctx, session.ballistics);
    }

    // Анализ: панель поверх сцены.
    if (session.analysis.isActive && session.analysis.report) {
      this.drawAnalysisPanel(
        ctx,
        width,
        height,
        session.analysis.report.summary,
        session.analysis.report.collapseRisk,
      );
    }

    this.hud?.draw(ctx, width, height, this.hudModel());

    this.drawNotice(ctx, width, height);
    this.debug.draw(
      ctx,
      this.debug.buildLines({
        graph: session.graph,
        zones: session.zones,
        objectives: session.objectives,
        scoring: session.scoring,
        analysis: session.analysis,
        ballistics: session.ballistics,
        physics: session.physics,
        projectiles: session.projectiles,
        effects: this.effects as EffectSystem,
        level: session.level,
        shotsUsed: session.shotsUsedCount,
        elapsedSeconds: session.elapsedSeconds,
        won: session.sessionOutcome === 'running' ? null : session.sessionOutcome === 'victory',
      }),
    );

    if (paused) {
      this.pause?.draw(ctx, width, height, {
        levelTitle: session.level.title,
        mission: session.level.description,
        shotsUsed: session.shotsUsedCount,
        maxShots: session.level.maxShots,
        score: session.scoring.current.total,
        objectives: session.objectives.statuses(),
      });
    }
  }

  private drawAnalysisPanel(
    ctx: CanvasRenderingContext2D,
    width: number,
    _height: number,
    summary: string,
    risk: number,
  ): void {
    ctx.save();
    ctx.font = '11px "IBM Plex Mono", monospace';
    const text = `АНАЛИЗ: ${summary} · риск ${(risk * 100).toFixed(0)}%`;
    const w = ctx.measureText(text).width + 24;
    const x = (width - w) / 2;
    const y = 62;
    ctx.fillStyle = 'rgba(18,22,26,0.85)';
    ctx.fillRect(x, y, w, 26);
    ctx.strokeStyle = '#3f7fd0';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 25);
    ctx.fillStyle = '#3f7fd0';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 12, y + 13);
    ctx.restore();
  }

  private drawNotice(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.notice) return;
    if (performance.now() > this.notice.until) {
      this.notice = null;
      return;
    }
    const colors: Record<string, string> = {
      info: '#e8823a',
      warning: '#e5c04a',
      danger: '#d0402f',
    };
    ctx.save();
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    const w = ctx.measureText(this.notice.text).width + 32;
    const x = (width - w) / 2;
    const y = height * 0.24;
    ctx.fillStyle = 'rgba(18,22,26,0.9)';
    ctx.fillRect(x, y, w, 32);
    ctx.strokeStyle = colors[this.notice.severity] ?? '#e8823a';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, 30);
    ctx.fillStyle = colors[this.notice.severity] ?? '#e8823a';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.notice.text, x + 16, y + 16);
    ctx.restore();
  }

  private drawResult(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const result = this.pendingLevelResult ?? this.session?.result;
    if (!result) return;
    const session = this.session;
    const levelId = session?.level.id ?? 'unknown';
    const record = this.save.getLevelRecord(levelId);

    this.result?.draw(ctx, width, height, {
      won: result.won,
      levelTitle: session?.level.title ?? '',
      rank: result.rank,
      breakdown: result.breakdown,
      shotsUsed: result.shotsUsed,
      maxShots: session?.level.maxShots ?? 3,
      generatorHealthPercent: result.generatorHealthPercent,
      destroyedPercent: result.destroyedPercent,
      redZoneMass: result.redZoneMass,
      redZoneLimit: session?.zones.redZones[0]?.definition.maximumDebrisMass ?? 0,
      greenZoneMass: result.greenZoneMass,
      bestScore: record?.bestScore ?? 0,
      isRecord: record?.bestScore === result.score,
      objectives: result.objectives,
      failureReason: result.failureReason,
      zones: session?.zones.statuses() ?? [],
    });
  }

  private menuModel(): ReturnType<() => Parameters<MainMenuController['draw']>[3]> {
    const levelId = this.levelManager.defaultLevelId;
    const record = this.save.getLevelRecord(levelId);
    return {
      version: GAME_VERSION,
      bestScore: record?.bestScore ?? 0,
      bestRank: (record?.bestRank as ReturnType<typeof ScoringSystem.rankFor>) ?? 'Нет результата',
      levelCompleted: this.save.hasCompleted(levelId),
      controlsHint: CONTROLS_HINT,
    };
  }

  private hudModel(): Parameters<HudController['draw']>[3] {
    const session = this.session as GameSession;
    const generator = session.generatorElement;
    const redZone = session.zones.redZones[0];
    const greenZone = session.zones.greenZones[0];
    const objectives = session.objectives.statuses();

    return {
      levelTitle: session.level.title,
      mission: session.level.description,
      shotsUsed: session.shotsUsedCount,
      maxShots: session.level.maxShots,
      generatorHealthPercent: generator ? generator.healthRatio * 100 : 100,
      generatorLabel: generator?.label ?? 'Генератор',
      redZoneMass: redZone?.largeDebrisMass ?? 0,
      redZoneLimit: redZone?.definition.maximumDebrisMass ?? 0,
      greenZoneMass: greenZone?.debrisMass ?? 0,
      score: session.scoring.current.total,
      rank: session.scoring.rank,
      objectives,
      analysisActive: session.analysis.isActive,
      trajectoryVisible: this.trajectoryVisible,
      elapsedSeconds: session.elapsedSeconds,
      frozen: this.slowMotionTimer > 0,
      shotInFlight: session.projectiles.active,
      controlsHint: CONTROLS_HINT,
      warning: this.objectivesWarning(objectives),
    };
  }

  private objectivesWarning(
    objectives: readonly { label: string; violated: boolean; value: string }[],
  ): string | null {
    const violated = objectives.find((o) => o.violated);
    return violated ? violated.label : null;
  }

  /** Прогноз траектории для внешнего использования (тесты, автопрохождение). */
  predictTrajectory(maxPoints = 110): ReturnType<GameSession['ballistics']['predict']> {
    if (!this.session) return [];
    return this.session.ballistics.predict({
      maxPoints,
      pointInterval: 0.05,
      environment: this.session.level.environment,
    });
  }

  /** Доступ к сессии для headless-проверок. */
  get currentSession(): GameSession | null {
    return this.session;
  }

  /** Синтетический ввод: движение мыши и отпускание. */
  simulateAimAndFire(worldX: number, worldY: number): boolean {
    if (!this.session || !this.camera) return false;
    const screen = this.camera.worldToScreen(worldX, worldY);
    this.inputPointerMove(screen.x, screen.y);
    this.inputPointerDown(screen.x, screen.y);
    this.inputPointerUp(screen.x, screen.y);
    return this.session.projectiles.active;
  }
}
