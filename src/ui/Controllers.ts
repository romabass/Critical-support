import type { SaveSettings } from '../core/SaveManager';
import { formatMass, formatPercent, formatTime } from '../core/MathUtils';
import type { ObjectiveStatusSnapshot } from '../data/ObjectiveData';
import type { ZoneStatus } from '../gameplay/ZoneController';
import type { ScoreBreakdown, Rank } from '../gameplay/ScoringSystem';
import { Palette } from '../render/Palette';
import { roundRect, withAlpha, type UiCanvas } from './UiCanvas';

export interface HudActions {
  readonly onPause: () => void;
  readonly onRestart: () => void;
  readonly onToggleAnalysis: () => void;
  readonly onToggleTrajectory: () => void;
}

export interface HudModel {
  readonly levelTitle: string;
  readonly mission: string;
  readonly shotsUsed: number;
  readonly maxShots: number;
  readonly generatorHealthPercent: number;
  readonly generatorLabel: string;
  readonly redZoneMass: number;
  readonly redZoneLimit: number;
  readonly greenZoneMass: number;
  readonly score: number;
  readonly rank: Rank;
  readonly objectives: readonly ObjectiveStatusSnapshot[];
  readonly analysisActive: boolean;
  readonly trajectoryVisible: boolean;
  readonly elapsedSeconds: number;
  readonly frozen: boolean;
  readonly shotInFlight: boolean;
  readonly controlsHint: readonly string[];
  readonly warning: string | null;
}

const PANEL = 'rgba(18,22,26,0.82)';
const BORDER = 'rgba(125,139,152,0.34)';

/** HUD игрового экрана: задание, ресурсы, цели, состояние объектов. */
export class HudController {
  constructor(
    private readonly ui: UiCanvas,
    private readonly actions: HudActions,
  ) {}

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, model: HudModel): void {
    void height;
    this.ui.begin();
    this.buildControls(width, height);
    this.drawTopBar(ctx, width, model);
    this.drawLeftPanel(ctx, width, height, model);
    this.drawRightPanel(ctx, width, height, model);
    this.drawControlsHint(ctx, width, height, model);
    this.ui.render(ctx);
  }

  /** Кнопки, которые нужно опросить после отрисовки. */
  get controlIds(): readonly string[] {
    return this.ui.controls.map((c) => c.id);
  }

  /** Диспетчеризация клика по кнопке HUD. */
  handleClick(id: string): boolean {
    switch (id) {
      case 'hud_pause':
        this.actions.onPause();
        return true;
      case 'hud_restart':
        this.actions.onRestart();
        return true;
      default:
        return false;
    }
  }

  private buildControls(width: number, height: number): void {
    void height;
    const buttonW = 118;
    const buttonH = 30;
    const x = width - buttonW - 14;
    this.ui.button('hud_pause', { x, y: 62, width: buttonW, height: buttonH }, 'ПАУЗА  [Esc]');
    this.ui.button(
      'hud_restart',
      { x, y: 62 + buttonH + 8, width: buttonW, height: buttonH },
      'СНАЧАТА  [R]',
    );
  }

  private drawTopBar(ctx: CanvasRenderingContext2D, width: number, model: HudModel): void {
    ctx.save();
    ctx.fillStyle = PANEL;
    ctx.fillRect(0, 0, width, 52);
    ctx.strokeStyle = BORDER;
    ctx.beginPath();
    ctx.moveTo(0, 52.5);
    ctx.lineTo(width, 52.5);
    ctx.stroke();

    ctx.fillStyle = Palette.orange;
    ctx.fillRect(0, 0, 6, 52);
    ctx.font = '700 15px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = Palette.textPrimary;
    ctx.fillText('КРИТИЧЕСКАЯ ОПОРА', 18, 18);

    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.fillStyle = Palette.textSecondary;
    ctx.fillText(model.levelTitle, 18, 37);

    // Индикатор запусков.
    const shotsX = 320;
    ctx.fillStyle = Palette.textSecondary;
    ctx.fillText('ЗАПУСКИ', shotsX, 18);
    for (let i = 0; i < model.maxShots; i++) {
      const used = i < model.shotsUsed;
      const active = model.shotInFlight && i === model.shotsUsed;
      ctx.beginPath();
      ctx.arc(shotsX + 8 + i * 20, 18, 7, 0, Math.PI * 2);
      ctx.fillStyle = used ? Palette.redDim : active ? Palette.orange : 'rgba(125,139,152,0.35)';
      ctx.fill();
      if (active) {
        ctx.strokeStyle = Palette.orange;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // Генератор.
    const genX = 520;
    ctx.fillStyle = Palette.textSecondary;
    ctx.fillText(model.generatorLabel.toUpperCase(), genX, 18);
    this.drawBar(
      ctx,
      genX,
      26,
      190,
      12,
      model.generatorHealthPercent / 100,
      this.generatorColor(model.generatorHealthPercent),
    );
    ctx.fillStyle = Palette.textPrimary;
    ctx.font = '700 12px "IBM Plex Mono", monospace';
    ctx.fillText(formatPercent(model.generatorHealthPercent), genX + 198, 32);

    // Красная зона.
    const redX = 740;
    ctx.fillStyle = Palette.textSecondary;
    ctx.fillText('КРАСНАЯ ЗОНА', redX, 18);
    const redRatio =
      model.redZoneLimit > 0 ? Math.min(1, model.redZoneMass / model.redZoneLimit) : 0;
    this.drawBar(ctx, redX, 26, 150, 12, redRatio, redRatio > 0.85 ? Palette.red : Palette.orange);
    ctx.fillStyle = Palette.textPrimary;
    ctx.font = '700 12px "IBM Plex Mono", monospace';
    ctx.fillText(`${Math.round(model.redZoneMass)} / ${model.redZoneLimit} кг`, redX + 158, 32);

    // Счёт и время.
    const scoreX = width - 330;
    ctx.fillStyle = Palette.textSecondary;
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.fillText('СЧЁТ', scoreX, 18);
    ctx.fillStyle = Palette.orange;
    ctx.font = '700 17px "IBM Plex Mono", monospace';
    ctx.fillText(String(Math.round(model.score)), scoreX, 38);

    ctx.fillStyle = Palette.textSecondary;
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.fillText('РАНГ', scoreX + 92, 18);
    ctx.fillStyle = Palette.textPrimary;
    ctx.font = '700 12px "IBM Plex Mono", monospace';
    ctx.fillText(model.rank, scoreX + 92, 38);

    ctx.fillStyle = Palette.textSecondary;
    ctx.fillText('ВРЕМЯ', scoreX + 210, 18);
    ctx.fillStyle = Palette.textPrimary;
    ctx.font = '700 15px "IBM Plex Mono", monospace';
    ctx.fillText(formatTime(model.elapsedSeconds), scoreX + 210, 38);

    ctx.restore();
  }

  private drawLeftPanel(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    model: HudModel,
  ): void {
    const panelW = 268;
    const panelH = 216;
    const x = 14;
    const y = 66;

    ctx.save();
    ctx.fillStyle = PANEL;
    roundRect(ctx, x, y, panelW, panelH, 5);
    ctx.fill();
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = Palette.orange;
    ctx.font = '700 11px "IBM Plex Mono", monospace';
    ctx.fillText('ЗАДАНИЕ', x + 12, y + 20);

    ctx.fillStyle = Palette.textSecondary;
    ctx.font = '11px "IBM Plex Mono", monospace';
    this.wrapText(ctx, model.mission, x + 12, y + 38, panelW - 24, 14);

    ctx.fillStyle = Palette.textMuted;
    ctx.font = '700 11px "IBM Plex Mono", monospace';
    ctx.fillText('ЦЕЛИ', x + 12, y + 96);

    let lineY = y + 114;
    for (const objective of model.objectives) {
      const mark = objective.violated ? '✕' : objective.completed ? '✓' : '•';
      const color = objective.violated
        ? Palette.red
        : objective.completed
          ? Palette.green
          : Palette.textSecondary;
      ctx.fillStyle = color;
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.fillText(mark, x + 12, lineY);
      ctx.fillStyle = Palette.textPrimary;
      ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillText(this.truncate(ctx, objective.label, panelW - 34), x + 26, lineY);
      ctx.fillStyle = Palette.textMuted;
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillText(objective.value, x + 26, lineY + 13);
      lineY += 28;
    }

    ctx.restore();
    void width;
    void height;
  }

  private drawRightPanel(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    model: HudModel,
  ): void {
    const panelW = 234;
    const panelH = 152;
    const x = width - panelW - 14;
    const y = height - panelH - 46;

    ctx.save();
    ctx.fillStyle = PANEL;
    roundRect(ctx, x, y, panelW, panelH, 5);
    ctx.fill();
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = Palette.green;
    ctx.font = '700 11px "IBM Plex Mono", monospace';
    ctx.fillText('БЕЗОПАСНАЯ ЗОНА', x + 12, y + 20);
    ctx.fillStyle = Palette.textPrimary;
    ctx.font = '700 15px "IBM Plex Mono", monospace';
    ctx.fillText(formatMass(model.greenZoneMass), x + 12, y + 40);

    ctx.fillStyle = Palette.textMuted;
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText(`Анализ: ${model.analysisActive ? 'ВКЛ' : 'выкл'}  [V]`, x + 12, y + 66);
    ctx.fillText(`Траектория: ${model.trajectoryVisible ? 'ВКЛ' : 'выкл'}  [T]`, x + 12, y + 84);
    ctx.fillText(
      model.frozen
        ? 'Замедление времени  [Space]'
        : `В полёте: ${model.shotInFlight ? 'снаряд' : 'нет'}`,
      x + 12,
      y + 102,
    );

    if (model.warning) {
      ctx.fillStyle = Palette.red;
      ctx.font = '700 11px "IBM Plex Mono", monospace';
      ctx.fillText(model.warning, x + 12, y + 128);
    }

    ctx.restore();
  }

  private drawControlsHint(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    model: HudModel,
  ): void {
    void height;
    const text = model.controlsHint.join('   ');
    ctx.save();
    ctx.font = '11px "IBM Plex Mono", monospace';
    const w = ctx.measureText(text).width + 24;
    const x = (width - w) / 2;
    const y = height - 34;
    ctx.fillStyle = PANEL;
    roundRect(ctx, x, y, w, 24, 4);
    ctx.fill();
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = Palette.textSecondary;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 12, y + 12);
    ctx.restore();
  }

  private drawBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    ratio: number,
    color: string,
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(38,46,54,1)';
    roundRect(ctx, x, y, w, h, 3);
    ctx.fill();
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();
    const fill = Math.max(0, Math.min(1, ratio)) * w;
    ctx.fillStyle = color;
    roundRect(ctx, x, y, fill, h, 3);
    ctx.fill();
    ctx.restore();
  }

  private generatorColor(health: number): string {
    if (health > 70) return Palette.green;
    if (health > 45) return Palette.orange;
    return Palette.red;
  }

  private truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 3 && ctx.measureText(`${out}...`).width > maxWidth) {
      out = out.slice(0, -1);
    }
    return `${out}...`;
  }

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines = 3,
  ): void {
    const words = text.split(' ');
    let line = '';
    let lineY = y;
    let lines = 0;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, lineY);
        lineY += lineHeight;
        lines++;
        line = word;
        if (lines >= maxLines) return;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, lineY);
  }
}

export interface ResultModel {
  readonly won: boolean;
  readonly levelTitle: string;
  readonly rank: Rank;
  readonly breakdown: ScoreBreakdown;
  readonly shotsUsed: number;
  readonly maxShots: number;
  readonly generatorHealthPercent: number;
  readonly destroyedPercent: number;
  readonly redZoneMass: number;
  readonly redZoneLimit: number;
  readonly greenZoneMass: number;
  readonly bestScore: number;
  readonly isRecord: boolean;
  readonly objectives: readonly ObjectiveStatusSnapshot[];
  readonly failureReason: string | null;
  readonly zones: readonly ZoneStatus[];
}

export interface ResultActions {
  readonly onRetry: () => void;
  readonly onMenu: () => void;
}

/** Экран результата: победа/поражение, детальный счёт, цели. */
export class ResultController {
  constructor(
    private readonly ui: UiCanvas,
    private readonly actions: ResultActions,
  ) {}

  handleClick(id: string): boolean {
    switch (id) {
      case 'result_retry':
        this.actions.onRetry();
        return true;
      case 'result_menu':
        this.actions.onMenu();
        return true;
      default:
        return false;
    }
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, model: ResultModel): void {
    this.ui.begin();

    ctx.save();
    ctx.fillStyle = 'rgba(10,13,16,0.9)';
    ctx.fillRect(0, 0, width, height);

    const panelW = Math.min(720, width - 60);
    const panelH = Math.min(560, height - 60);
    const px = (width - panelW) / 2;
    const py = (height - panelH) / 2;

    ctx.fillStyle = Palette.graphite;
    roundRect(ctx, px, py, panelW, panelH, 6);
    ctx.fill();
    ctx.strokeStyle = model.won ? Palette.green : Palette.red;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Шапка.
    ctx.fillStyle = model.won ? Palette.green : Palette.red;
    ctx.fillRect(px, py, panelW, 4);
    ctx.font = '700 26px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(model.won ? 'ЗАДАНИЕ ВЫПОЛНЕНО' : 'ЗАДАНИЕ ПРОВАЛЕНО', px + 28, py + 34);
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.fillStyle = Palette.textSecondary;
    ctx.fillText(model.levelTitle, px + 28, py + 58);

    // Ранг и счёт.
    ctx.textAlign = 'right';
    ctx.fillStyle = Palette.textSecondary;
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText('ТЕХНИЧЕСКИЙ РАНГ', px + panelW - 28, py + 26);
    ctx.fillStyle = Palette.orange;
    ctx.font = '700 22px "IBM Plex Mono", monospace';
    ctx.fillText(model.rank, px + panelW - 28, py + 48);
    ctx.fillStyle = Palette.textPrimary;
    ctx.font = '700 26px "IBM Plex Mono", monospace';
    ctx.fillText(String(model.breakdown.total), px + panelW - 28, py + 76);
    if (model.isRecord) {
      ctx.fillStyle = Palette.green;
      ctx.font = '700 11px "IBM Plex Mono", monospace';
      ctx.fillText('НОВЫЙ РЕКОРД', px + panelW - 28, py + 96);
    }
    ctx.textAlign = 'left';

    const colX = px + 28;
    const colW = (panelW - 56) / 2;

    // Цели.
    let y = py + 96;
    ctx.fillStyle = Palette.orange;
    ctx.font = '700 12px "IBM Plex Mono", monospace';
    ctx.fillText('ЦЕЛИ', colX, y);
    y += 18;
    for (const objective of model.objectives) {
      const mark = objective.violated ? '✕' : objective.completed ? '✓' : '•';
      ctx.fillStyle = objective.violated
        ? Palette.red
        : objective.completed
          ? Palette.green
          : Palette.textSecondary;
      ctx.font = '700 12px "IBM Plex Mono", monospace';
      ctx.fillText(mark, colX, y);
      ctx.fillStyle = Palette.textPrimary;
      ctx.font = '11px "IBM Plex Mono", monospace';
      ctx.fillText(objective.label, colX + 16, y);
      ctx.fillStyle = Palette.textMuted;
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillText(objective.value, colX + 16, y + 14);
      if (objective.failureReason) {
        ctx.fillStyle = Palette.red;
        ctx.font = '10px "IBM Plex Mono", monospace';
        ctx.fillText(objective.failureReason, colX + 16, y + 27);
        y += 13;
      }
      y += 40;
    }

    // Счёт: разбивка.
    const scoreX = colX + colW;
    let sy = py + 96;
    ctx.fillStyle = Palette.orange;
    ctx.font = '700 12px "IBM Plex Mono", monospace';
    ctx.fillText('РАЗБИВКА ОЧКОВ', scoreX, sy);
    sy += 20;
    const rows: [string, number, string][] = [
      ['База', model.breakdown.baseScore, Palette.textPrimary],
      ['Бонус за цели', model.breakdown.objectiveBonus, Palette.green],
      ['Генератор', model.breakdown.generatorBonus, Palette.green],
      ['Безопасные обломки', model.breakdown.safeDebrisBonus, Palette.green],
      ['Точность', model.breakdown.accuracyBonus, Palette.green],
      ['За время', model.breakdown.timeBonus, Palette.green],
      ['Штраф за запуски', model.breakdown.shotPenalty, Palette.red],
      ['Штраф за красную зону', model.breakdown.redZonePenalty, Palette.red],
      ['Избыточные повреждения', model.breakdown.unnecessaryDamagePenalty, Palette.red],
    ];
    ctx.font = '11px "IBM Plex Mono", monospace';
    for (const [label, value, color] of rows) {
      ctx.fillStyle = Palette.textSecondary;
      ctx.fillText(label, scoreX, sy);
      ctx.textAlign = 'right';
      ctx.fillStyle = color;
      ctx.fillText(`${value > 0 ? '+' : ''}${value}`, scoreX + colW - 20, sy);
      ctx.textAlign = 'left';
      sy += 16;
    }

    // Сводные метрики.
    sy += 8;
    ctx.fillStyle = Palette.textSecondary;
    ctx.font = '11px "IBM Plex Mono", monospace';
    const metrics: [string, string][] = [
      ['Запуски', `${model.shotsUsed} / ${model.maxShots}`],
      ['Генератор', formatPercent(model.generatorHealthPercent, 1)],
      ['Разрушение цели', formatPercent(model.destroyedPercent)],
      ['Красная зона', `${Math.round(model.redZoneMass)} / ${model.redZoneLimit} кг`],
      ['Зелёная зона', formatMass(model.greenZoneMass)],
      ['Лучший счёт', String(model.bestScore)],
    ];
    for (const [label, value] of metrics) {
      ctx.fillStyle = Palette.textSecondary;
      ctx.fillText(label, scoreX, sy);
      ctx.textAlign = 'right';
      ctx.fillStyle = Palette.textPrimary;
      ctx.fillText(value, scoreX + colW - 20, sy);
      ctx.textAlign = 'left';
      sy += 16;
    }

    if (model.failureReason) {
      ctx.fillStyle = Palette.red;
      ctx.font = '700 11px "IBM Plex Mono", monospace';
      ctx.fillText(`ПРИЧИНА: ${model.failureReason}`, colX, py + panelH - 74);
    }

    ctx.restore();

    // Кнопки.
    const buttonW = 190;
    const buttonH = 38;
    const by = py + panelH - 52;
    this.ui.button(
      'result_retry',
      { x: px + 28, y: by, width: buttonW, height: buttonH },
      'ПОВТОРИТЬ  [R]',
      { accent: Palette.orange },
    );
    this.ui.button(
      'result_menu',
      { x: px + 28 + buttonW + 14, y: by, width: buttonW, height: buttonH },
      'В МЕНЮ  [Esc]',
      { accent: Palette.textSecondary },
    );
    this.ui.render(ctx);
  }
}

export interface PauseModel {
  readonly levelTitle: string;
  readonly mission: string;
  readonly shotsUsed: number;
  readonly maxShots: number;
  readonly score: number;
  readonly objectives: readonly ObjectiveStatusSnapshot[];
}

export interface PauseActions {
  readonly onResume: () => void;
  readonly onRestart: () => void;
  readonly onMenu: () => void;
  readonly onSettings: () => void;
}

/** Меню паузы. */
export class PauseController {
  constructor(
    private readonly ui: UiCanvas,
    private readonly actions: PauseActions,
  ) {}

  handleClick(id: string): boolean {
    switch (id) {
      case 'pause_resume':
        this.actions.onResume();
        return true;
      case 'pause_restart':
        this.actions.onRestart();
        return true;
      case 'pause_settings':
        this.actions.onSettings();
        return true;
      case 'pause_menu':
        this.actions.onMenu();
        return true;
      default:
        return false;
    }
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, model: PauseModel): void {
    this.ui.begin();

    ctx.save();
    ctx.fillStyle = 'rgba(10,13,16,0.82)';
    ctx.fillRect(0, 0, width, height);

    const panelW = Math.min(420, width - 80);
    const panelH = 380;
    const px = (width - panelW) / 2;
    const py = (height - panelH) / 2;

    ctx.fillStyle = Palette.graphite;
    roundRect(ctx, px, py, panelW, panelH, 6);
    ctx.fill();
    ctx.strokeStyle = Palette.orange;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = Palette.orange;
    ctx.font = '700 22px "IBM Plex Mono", monospace';
    ctx.fillText('ПАУЗА', px + 28, py + 34);
    ctx.fillStyle = Palette.textSecondary;
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillText(model.levelTitle, px + 28, py + 56);

    ctx.fillStyle = Palette.textMuted;
    ctx.font = '11px "IBM Plex Mono", monospace';
    let y = py + 84;
    ctx.fillText(`Запуски: ${model.shotsUsed} / ${model.maxShots}`, px + 28, y);
    y += 16;
    ctx.fillText(`Счёт: ${Math.round(model.score)}`, px + 28, y);
    y += 22;
    ctx.fillStyle = Palette.orange;
    ctx.fillText('ЦЕЛИ', px + 28, y);
    y += 18;
    ctx.fillStyle = Palette.textSecondary;
    for (const objective of model.objectives) {
      const mark = objective.violated ? '✕' : objective.completed ? '✓' : '•';
      ctx.fillText(`${mark} ${objective.label}`, px + 32, y);
      y += 16;
    }

    ctx.restore();

    const buttonW = panelW - 56;
    const buttonH = 38;
    let by = py + panelH - 4 * (buttonH + 10) + 10;
    this.ui.button(
      'pause_resume',
      { x: px + 28, y: by, width: buttonW, height: buttonH },
      'ПРОДОЛЖИТЬ  [Esc]',
      {
        accent: Palette.green,
      },
    );
    by += buttonH + 10;
    this.ui.button(
      'pause_restart',
      { x: px + 28, y: by, width: buttonW, height: buttonH },
      'ПЕРЕЗАПУСТИТЬ  [R]',
    );
    by += buttonH + 10;
    this.ui.button(
      'pause_settings',
      { x: px + 28, y: by, width: buttonW, height: buttonH },
      'НАСТРОЙКИ',
      {
        accent: Palette.textSecondary,
      },
    );
    by += buttonH + 10;
    this.ui.button(
      'pause_menu',
      { x: px + 28, y: by, width: buttonW, height: buttonH },
      'В ГЛАВНОЕ МЕНЮ',
      {
        accent: Palette.textSecondary,
      },
    );
    this.ui.render(ctx);
  }
}

export interface MenuModel {
  readonly version: string;
  readonly bestScore: number;
  readonly bestRank: Rank;
  readonly levelCompleted: boolean;
  readonly controlsHint: readonly string[];
}

export interface MenuActions {
  readonly onStart: () => void;
  readonly onSettings: () => void;
  readonly onExit: () => void;
}

/** Главное меню. */
export class MainMenuController {
  constructor(
    private readonly ui: UiCanvas,
    private readonly actions: MenuActions,
  ) {}

  handleClick(id: string): boolean {
    switch (id) {
      case 'menu_start':
        this.actions.onStart();
        return true;
      case 'menu_settings':
        this.actions.onSettings();
        return true;
      case 'menu_exit':
        this.actions.onExit();
        return true;
      default:
        return false;
    }
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, model: MenuModel): void {
    this.ui.begin();

    ctx.save();
    this.drawBackdrop(ctx, width, height);

    ctx.textBaseline = 'middle';
    const centerX = width / 2;
    let y = height * 0.28;

    ctx.font = '700 46px "IBM Plex Mono", monospace';
    ctx.fillStyle = Palette.orange;
    ctx.fillText('КРИТИЧЕСКАЯ', centerX - ctx.measureText('КРИТИЧЕСКАЯ').width / 2, y);
    y += 46;
    ctx.fillStyle = Palette.textPrimary;
    ctx.fillText('ОПОРА', centerX - ctx.measureText('ОПОРА').width / 2, y);

    y += 30;
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.fillStyle = Palette.textMuted;
    const subtitle = 'Служба контролируемого демонтажа · инженерная баллистика';
    ctx.fillText(subtitle, centerX - ctx.measureText(subtitle).width / 2, y);

    y += 46;
    ctx.font = '700 20px "IBM Plex Mono", monospace';
    if (model.levelCompleted) {
      ctx.fillStyle = Palette.green;
      ctx.fillText(
        `Рекорд: ${model.bestScore} · ${model.bestRank}`,
        centerX - ctx.measureText(`Рекорд: ${model.bestScore} · ${model.bestRank}`).width / 2,
        y,
      );
    } else {
      ctx.fillStyle = Palette.textSecondary;
      ctx.fillText(
        'Уровень не пройден',
        centerX - ctx.measureText('Уровень не пройден').width / 2,
        y,
      );
    }

    ctx.restore();

    const buttonW = 280;
    const buttonH = 44;
    const bx = (width - buttonW) / 2;
    let by = height * 0.58;
    this.ui.button(
      'menu_start',
      { x: bx, y: by, width: buttonW, height: buttonH },
      'НАЧАТЬ РАБОТУ',
      {
        accent: Palette.orange,
      },
    );
    by += buttonH + 12;
    this.ui.button(
      'menu_settings',
      { x: bx, y: by, width: buttonW, height: buttonH },
      'НАСТРОЙКИ',
      {
        accent: Palette.textSecondary,
      },
    );
    by += buttonH + 12;
    this.ui.button('menu_exit', { x: bx, y: by, width: buttonW, height: buttonH }, 'ВЫХОД', {
      accent: Palette.textSecondary,
    });

    // Подсказки и версия.
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.fillStyle = Palette.textMuted;
    const hint = model.controlsHint.join('   ');
    ctx.fillText(hint, width / 2 - ctx.measureText(hint).width / 2, height - 54);
    ctx.fillStyle = 'rgba(102,115,126,0.9)';
    ctx.fillText(`v${model.version}`, width - 40, height - 28);
    ctx.restore();

    this.ui.render(ctx);
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0d1116');
    gradient.addColorStop(1, '#1c232a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(125,139,152,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += 44) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    for (let y = 0; y <= height; y += 44) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
    }
    ctx.stroke();

    // Декоративная схема фермы.
    ctx.strokeStyle = withAlpha(Palette.steel, 0.16);
    ctx.lineWidth = 2;
    ctx.beginPath();
    const baseY = height * 0.86;
    ctx.moveTo(width * 0.1, baseY);
    ctx.lineTo(width * 0.1, baseY - 150);
    ctx.lineTo(width * 0.16, baseY - 190);
    ctx.lineTo(width * 0.22, baseY - 150);
    ctx.lineTo(width * 0.22, baseY);
    ctx.moveTo(width * 0.1, baseY - 150);
    ctx.lineTo(width * 0.22, baseY - 150);
    ctx.moveTo(width * 0.13, baseY - 190);
    ctx.lineTo(width * 0.19, baseY - 150);
    ctx.stroke();
  }
}

export interface SettingsModel {
  readonly settings: SaveSettings;
  readonly fullscreenSupported: boolean;
}

export interface SettingsActions {
  readonly onBack: () => void;
  readonly onChange: (patch: Partial<SaveSettings>) => void;
  readonly onResetProgress: () => void;
}

export type QualityOption = 'low' | 'medium' | 'high';

/** Экран настроек. */
export class SettingsController {
  constructor(
    private readonly ui: UiCanvas,
    private readonly actions: SettingsActions,
  ) {}

  handleClick(id: string): boolean {
    if (id === 'settings_back') {
      this.actions.onBack();
      return true;
    }
    if (id.startsWith('settings_quality_')) {
      const quality = id.replace('settings_quality_', '') as QualityOption;
      this.actions.onChange({ particleQuality: quality });
      return true;
    }
    return false;
  }

  draw(ctx: CanvasRenderingContext2D, width: number, height: number, model: SettingsModel): void {
    this.ui.begin();

    ctx.save();
    ctx.fillStyle = 'rgba(10,13,16,0.94)';
    ctx.fillRect(0, 0, width, height);

    const panelW = Math.min(520, width - 60);
    const panelH = 440;
    const px = (width - panelW) / 2;
    const py = (height - panelH) / 2;

    ctx.fillStyle = Palette.graphite;
    roundRect(ctx, px, py, panelW, panelH, 6);
    ctx.fill();
    ctx.strokeStyle = Palette.orange;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textBaseline = 'middle';
    ctx.fillStyle = Palette.orange;
    ctx.font = '700 22px "IBM Plex Mono", monospace';
    ctx.fillText('НАСТРОЙКИ', px + 28, py + 34);
    ctx.restore();

    const sliderW = 240;
    const sx = px + 200;
    let y = py + 80;

    this.ui.slider(
      'settings_sfx',
      { x: sx, y, width: sliderW, height: 28 },
      'Громкость эффектов',
      model.settings.sfxVolume,
      0,
      1,
      {
        accent: Palette.green,
      },
    );
    y += 46;
    this.ui.slider(
      'settings_music',
      { x: sx, y, width: sliderW, height: 28 },
      'Громкость музыки',
      model.settings.musicVolume,
      0,
      1,
      {
        accent: Palette.green,
      },
    );
    y += 46;

    // Качество частиц: три кнопки-уровня.
    ctx.save();
    ctx.fillStyle = Palette.textPrimary;
    ctx.font = '13px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText('Качество частиц', sx, y + 14);
    ctx.restore();
    const qW = 76;
    const qualities: QualityOption[] = ['low', 'medium', 'high'];
    const qLabels: Record<QualityOption, string> = { low: 'Низк', medium: 'Средн', high: 'Выс' };
    qualities.forEach((q, i) => {
      this.ui.button(
        `settings_quality_${q}`,
        { x: sx + 250 + i * (qW + 6), y, width: qW, height: 28 },
        qLabels[q],
        { accent: model.settings.particleQuality === q ? Palette.orange : Palette.textSecondary },
      );
    });
    y += 42;

    this.ui.toggle(
      'settings_debug',
      { x: sx, y, width: sliderW, height: 26 },
      'Отладочный режим [F1]',
      model.settings.debugMode,
    );
    y += 34;
    this.ui.toggle(
      'settings_trajectory',
      { x: sx, y, width: sliderW, height: 26 },
      'Показывать траекторию [T]',
      model.settings.showTrajectory,
    );
    y += 34;
    this.ui.toggle(
      'settings_fullscreen',
      { x: sx, y, width: sliderW, height: 26 },
      'Полноэкранный режим',
      model.settings.fullscreen,
      { disabled: !model.fullscreenSupported },
    );
    y += 44;

    this.ui.button('settings_back', { x: px + 28, y, width: 200, height: 36 }, 'НАЗАД', {
      accent: Palette.green,
    });
    this.ui.button(
      'settings_reset',
      { x: px + 240, y, width: 240, height: 36 },
      'СБРОСИТЬ ПРОГРЕСС',
      { accent: Palette.red },
    );

    this.ui.render(ctx);
  }
}
