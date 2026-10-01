/** Immediate-mode GUI поверх Canvas2D: кнопки, ползунки, чекбоксы. */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ControlType = 'button' | 'toggle' | 'slider' | 'label';

/** Опции оформления и состояния контрола. */
export type ButtonOptions = Partial<
  Pick<
    Control,
    | 'hovered'
    | 'pressed'
    | 'focused'
    | 'value'
    | 'checked'
    | 'min'
    | 'max'
    | 'disabled'
    | 'hint'
    | 'accent'
  >
>;

export interface Control {
  readonly id: string;
  readonly type: ControlType;
  readonly rect: Rect;
  readonly label: string;
  hovered?: boolean;
  pressed?: boolean;
  focused?: boolean;
  /** Значение для toggle/slider. */
  value?: number;
  checked?: boolean;
  min?: number;
  max?: number;
  disabled?: boolean;
  hint?: string;
  accent?: string;
}

export interface ButtonClick {
  readonly id: string;
  readonly payload?: unknown;
}

export type Theme = {
  readonly bg: string;
  readonly panel: string;
  readonly panelBorder: string;
  readonly text: string;
  readonly textMuted: string;
  readonly accent: string;
  readonly danger: string;
  readonly success: string;
};

export const DEFAULT_THEME: Theme = {
  bg: '#12161a',
  panel: '#1b2127',
  panelBorder: '#3a444d',
  text: '#e6edf3',
  textMuted: '#9aa7b2',
  accent: '#e8823a',
  danger: '#d0402f',
  success: '#3fae62',
};

export function pointInRect(px: number, py: number, rect: Rect): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

/**
 * Набор контролов и их отрисовка. Логика игры не зависит от UI —
 * контроллеры просто запрашивают значения и реагируют на клики.
 */
export class UiCanvas {
  readonly controls: Control[] = [];
  private hotId: string | null = null;
  private activeId: string | null = null;
  private theme: Theme;

  constructor(theme: Theme = DEFAULT_THEME) {
    this.theme = theme;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
  }

  get currentTheme(): Theme {
    return this.theme;
  }

  begin(): void {
    this.controls.length = 0;
  }

  button(id: string, rect: Rect, label: string, options: ButtonOptions = {}): Control {
    return this.add({ id, type: 'button', rect, label, ...options });
  }

  toggle(
    id: string,
    rect: Rect,
    label: string,
    checked: boolean,
    options: ButtonOptions = {},
  ): Control {
    return this.add({ id, type: 'toggle', rect, label, checked, ...options });
  }

  slider(
    id: string,
    rect: Rect,
    label: string,
    value: number,
    min: number,
    max: number,
    options: ButtonOptions = {},
  ): Control {
    return this.add({ id, type: 'slider', rect, label, value, min, max, ...options });
  }

  label(id: string, rect: Rect, text: string, options: ButtonOptions = {}): Control {
    return this.add({ id, type: 'label', rect, label: text, ...options });
  }

  private add(control: Control): Control {
    this.controls.push(control);
    return control;
  }

  /** Обновление наведения/нажатия. Возвращает id кликнутых контролов. */
  handlePointerMove(x: number, y: number): void {
    this.hotId = null;
    for (const control of this.controls) {
      control.hovered = !control.disabled && pointInRect(x, y, control.rect);
      if (control.hovered) this.hotId = control.id;
    }
  }

  /** Сброс состояния наведения (например, при уходе курсора за окно). */
  clearHover(): void {
    this.hotId = null;
    for (const control of this.controls) control.hovered = false;
  }

  handlePointerDown(x: number, y: number): string | null {
    for (const control of this.controls) {
      if (control.disabled) continue;
      if (pointInRect(x, y, control.rect)) {
        control.pressed = true;
        this.activeId = control.id;
        return control.id;
      }
    }
    return null;
  }

  handlePointerUp(x: number, y: number): string | null {
    const active = this.activeId;
    this.activeId = null;
    for (const control of this.controls) control.pressed = false;
    if (!active) return null;
    const control = this.controls.find((c) => c.id === active);
    if (!control || control.disabled) return null;
    if (!pointInRect(x, y, control.rect)) return null;
    if (control.type === 'toggle') control.checked = !control.checked;
    return active;
  }

  handleDrag(x: number): string | null {
    if (!this.activeId) return null;
    const control = this.controls.find((c) => c.id === this.activeId);
    if (!control || control.type !== 'slider') return null;
    this.applySlider(control, x);
    return control.id;
  }

  get draggedSliderId(): string | null {
    return this.activeId && this.controls.find((c) => c.id === this.activeId)?.type === 'slider'
      ? this.activeId
      : null;
  }

  private applySlider(control: Control, x: number): void {
    if (control.min === undefined || control.max === undefined) return;
    const t = Math.min(1, Math.max(0, (x - control.rect.x) / control.rect.width));
    control.value = control.min + (control.max - control.min) * t;
  }

  get hotControlId(): string | null {
    return this.hotId;
  }

  getValue(id: string): number | undefined {
    return this.controls.find((c) => c.id === id)?.value;
  }

  isChecked(id: string): boolean {
    return this.controls.find((c) => c.id === id)?.checked ?? false;
  }

  /** Отрисовка всех контролов текущего кадра. */
  render(ctx: CanvasRenderingContext2D): void {
    const t = this.theme;
    for (const control of this.controls) {
      switch (control.type) {
        case 'label':
          this.renderLabel(ctx, control, t);
          break;
        case 'button':
          this.renderButton(ctx, control, t);
          break;
        case 'toggle':
          this.renderToggle(ctx, control, t);
          break;
        case 'slider':
          this.renderSlider(ctx, control, t);
          break;
      }
    }
  }

  private renderLabel(ctx: CanvasRenderingContext2D, control: Control, t: Theme): void {
    ctx.save();
    ctx.fillStyle = control.accent ?? t.text;
    ctx.font = control.hint
      ? '600 12px "IBM Plex Mono", monospace'
      : '13px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(control.label, control.rect.x, control.rect.y + control.rect.height / 2);
    if (control.hint) {
      ctx.fillStyle = t.textMuted;
      ctx.font = '10px "IBM Plex Mono", monospace';
      ctx.fillText(control.hint, control.rect.x, control.rect.y + control.rect.height / 2 + 15);
    }
    ctx.restore();
  }

  private renderButton(ctx: CanvasRenderingContext2D, control: Control, t: Theme): void {
    const { rect } = control;
    ctx.save();
    const base = control.accent ?? t.accent;
    ctx.fillStyle = control.pressed
      ? withAlpha(base, 0.42)
      : control.hovered
        ? withAlpha(base, 0.24)
        : 'rgba(27,33,39,0.92)';
    roundRect(ctx, rect.x, rect.y, rect.width, rect.height, 4);
    ctx.fill();
    ctx.strokeStyle = control.disabled
      ? 'rgba(125,139,152,0.3)'
      : control.hovered
        ? base
        : t.panelBorder;
    ctx.lineWidth = control.hovered ? 2 : 1;
    ctx.stroke();

    ctx.fillStyle = control.disabled ? t.textMuted : control.hovered ? t.text : base;
    ctx.font = '600 13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(control.label, rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.restore();
  }

  private renderToggle(ctx: CanvasRenderingContext2D, control: Control, t: Theme): void {
    const { rect } = control;
    const boxSize = 18;
    const boxY = rect.y + (rect.height - boxSize) / 2;
    ctx.save();
    ctx.fillStyle = control.hovered ? withAlpha(t.accent, 0.22) : 'rgba(27,33,39,0.92)';
    roundRect(ctx, rect.x, rect.y, rect.width, rect.height, 4);
    ctx.fill();
    ctx.strokeStyle = control.hovered ? t.accent : t.panelBorder;
    ctx.lineWidth = control.hovered ? 2 : 1;
    ctx.stroke();

    ctx.strokeStyle = control.checked ? t.success : t.panelBorder;
    ctx.fillStyle = control.checked ? withAlpha(t.success, 0.22) : 'transparent';
    ctx.lineWidth = 2;
    roundRect(ctx, rect.x + 8, boxY, boxSize, boxSize, 3);
    ctx.fill();
    ctx.stroke();
    if (control.checked) {
      ctx.strokeStyle = t.success;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(rect.x + 12, boxY + 9);
      ctx.lineTo(rect.x + 16, boxY + 13.5);
      ctx.lineTo(rect.x + 23, boxY + 5);
      ctx.stroke();
    }

    ctx.fillStyle = control.hovered ? t.text : t.text;
    ctx.font = '13px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(control.label, rect.x + boxSize + 16, rect.y + rect.height / 2);
    ctx.restore();
  }

  private renderSlider(ctx: CanvasRenderingContext2D, control: Control, t: Theme): void {
    const { rect } = control;
    const value = control.value ?? 0;
    const min = control.min ?? 0;
    const max = control.max ?? 1;
    const ratio = max > min ? (value - min) / (max - min) : 0;
    const barY = rect.y + rect.height / 2;

    ctx.save();
    ctx.fillStyle = t.text;
    ctx.font = '12px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(control.label, rect.x, rect.y + 2);
    ctx.fillStyle = t.textMuted;
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(ratio * 100)}%`, rect.x + rect.width, rect.y + 2);

    ctx.fillStyle = 'rgba(38,46,54,1)';
    roundRect(ctx, rect.x, barY, rect.width, 6, 3);
    ctx.fill();
    ctx.strokeStyle = t.panelBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = control.accent ?? t.accent;
    roundRect(ctx, rect.x, barY, rect.width * ratio, 6, 3);
    ctx.fill();

    const knobX = rect.x + rect.width * ratio;
    ctx.fillStyle = t.text;
    ctx.beginPath();
    ctx.arc(knobX, barY + 3, control.hovered || control.pressed ? 7 : 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function withAlpha(hex: string, alpha: number): string {
  if (hex.startsWith('rgba')) return hex;
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
