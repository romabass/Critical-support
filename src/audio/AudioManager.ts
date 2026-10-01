import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/GameEvents';
import type { SaveSettings } from '../core/SaveManager';
import {
  renderBuffer,
  type AudioBufferLike,
  type AudioContextLike,
  type ToneOptions,
} from './Synth';

export type AudioCue =
  | 'ui_click'
  | 'ui_hover'
  | 'launch'
  | 'impact_soft'
  | 'impact_hard'
  | 'glass_shatter'
  | 'wood_break'
  | 'concrete_break'
  | 'steel_break'
  | 'connection_break'
  | 'generator_hit'
  | 'victory'
  | 'defeat'
  | 'countdown';

interface CueRecipe {
  readonly tones: readonly ToneOptions[];
  readonly gain: number;
}

const SILENCE: ToneOptions = { type: 'sine', frequency: 0, duration: 0.001, gain: 0 };

/** Рецепты звуков: полностью синтетические, без внешних файлов. */
export const CUES: Record<AudioCue, CueRecipe> = {
  ui_click: {
    tones: [{ ...SILENCE, frequency: 520, duration: 0.06, decay: 26, gain: 0.5 }],
    gain: 0.5,
  },
  ui_hover: {
    tones: [{ ...SILENCE, frequency: 760, duration: 0.04, decay: 34, gain: 0.28 }],
    gain: 0.35,
  },
  launch: {
    tones: [
      { type: 'sawtooth', frequency: 180, duration: 0.28, sweep: 420, decay: 9, gain: 0.5 },
      { type: 'noise', frequency: 0, duration: 0.22, decay: 12, gain: 0.35 },
    ],
    gain: 0.6,
  },
  impact_soft: {
    tones: [{ type: 'sine', frequency: 140, duration: 0.16, sweep: -60, decay: 20, gain: 0.7 }],
    gain: 0.55,
  },
  impact_hard: {
    tones: [
      { type: 'sine', frequency: 90, duration: 0.32, sweep: -40, decay: 12, gain: 0.85 },
      { type: 'noise', frequency: 0, duration: 0.24, decay: 16, gain: 0.5 },
    ],
    gain: 0.75,
  },
  glass_shatter: {
    tones: [
      { type: 'noise', frequency: 0, duration: 0.34, decay: 13, gain: 0.6, seed: 7 },
      { type: 'triangle', frequency: 2400, duration: 0.22, sweep: -900, decay: 18, gain: 0.35 },
    ],
    gain: 0.55,
  },
  wood_break: {
    tones: [
      { type: 'square', frequency: 210, duration: 0.2, sweep: -110, decay: 16, gain: 0.5 },
      { type: 'noise', frequency: 0, duration: 0.18, decay: 20, gain: 0.4, seed: 11 },
    ],
    gain: 0.6,
  },
  concrete_break: {
    tones: [
      { type: 'noise', frequency: 0, duration: 0.42, decay: 9, gain: 0.8, seed: 3 },
      { type: 'sine', frequency: 78, duration: 0.4, sweep: -30, decay: 10, gain: 0.7 },
    ],
    gain: 0.72,
  },
  steel_break: {
    tones: [
      { type: 'triangle', frequency: 880, duration: 0.4, sweep: -420, decay: 9, gain: 0.45 },
      { type: 'noise', frequency: 0, duration: 0.28, decay: 14, gain: 0.5, seed: 23 },
    ],
    gain: 0.62,
  },
  connection_break: {
    tones: [{ type: 'square', frequency: 320, duration: 0.18, sweep: -180, decay: 22, gain: 0.4 }],
    gain: 0.5,
  },
  generator_hit: {
    tones: [
      { type: 'square', frequency: 150, duration: 0.42, sweep: -80, decay: 8, gain: 0.6 },
      { type: 'triangle', frequency: 62, duration: 0.44, decay: 9, gain: 0.6 },
    ],
    gain: 0.68,
  },
  victory: {
    tones: [
      { type: 'triangle', frequency: 392, duration: 0.5, decay: 4, gain: 0.5 },
      { type: 'triangle', frequency: 523, duration: 0.55, decay: 3.4, gain: 0.45, attack: 0.12 },
      { type: 'triangle', frequency: 659, duration: 0.6, decay: 3, gain: 0.4, attack: 0.24 },
    ],
    gain: 0.7,
  },
  defeat: {
    tones: [
      { type: 'sawtooth', frequency: 220, duration: 0.7, sweep: -110, decay: 4, gain: 0.5 },
      {
        type: 'sine',
        frequency: 110,
        duration: 0.8,
        sweep: -40,
        decay: 3.4,
        gain: 0.5,
        attack: 0.1,
      },
    ],
    gain: 0.65,
  },
  countdown: {
    tones: [{ type: 'square', frequency: 620, duration: 0.12, decay: 20, gain: 0.4 }],
    gain: 0.45,
  },
};

export interface PlayOptions {
  readonly volume?: number;
  readonly pitch?: number;
  readonly pan?: number;
}

/** Реальный WebAudio-бэкенд. */
class WebAudioBackend {
  private buffers = new Map<AudioCue, AudioBufferLike>();

  constructor(private readonly ctx: AudioContextLike) {}

  play(cue: AudioCue, volume: number, pitch: number): void {
    const recipe = CUES[cue];
    if (!recipe) return;
    for (const tone of recipe.tones) {
      let buffer = this.buffers.get(cue);
      if (!buffer || buffer.sampleRate !== this.ctx.sampleRate) {
        buffer = renderBuffer(this.ctx.sampleRate, tone.duration, tone);
        this.buffers.set(cue, buffer);
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = false;
      const gain = this.ctx.createGain();
      const out = Math.max(0, Math.min(1, volume * recipe.gain * (tone.gain ?? 0.6)));
      gain.gain.value = out;
      source.connect(gain);
      gain.connect(this.ctx.destination);
      try {
        source.start(this.ctx.currentTime);
      } catch {
        /* контекст может быть в состоянии suspended до первого жеста */
      }
      void pitch;
    }
  }

  dispose(): void {
    this.buffers.clear();
  }
}

/** Тихий бэкенд для headless-режима и тестов: только считает события. */
export class SilentAudioBackend {
  readonly played: { cue: AudioCue; volume: number; pitch: number }[] = [];

  play(cue: AudioCue, volume: number, pitch: number): void {
    this.played.push({ cue, volume, pitch });
  }

  dispose(): void {
    this.played.length = 0;
  }
}

export type AudioBackend = WebAudioBackend | SilentAudioBackend;

/**
 * Аудиоменеджер: реестр событий, громкость SFX/музыки, синтез звука.
 * Реализует интерфейс и работает без звуковых файлов.
 */
export class AudioManager {
  private sfxVolume: number;
  private musicVolume: number;
  private backend: AudioBackend;
  private context: AudioContextLike | null = null;
  private musicSource: { stop: (t?: number) => void } | null = null;
  private musicBuffer: AudioBufferLike | null = null;
  private lastPlayedAt = new Map<AudioCue, number>();
  private muted = false;

  constructor(
    private readonly events: EventBus<GameEvents>,
    settings?: Partial<SaveSettings>,
    factory?: () => AudioContextLike | null,
  ) {
    this.sfxVolume = settings?.sfxVolume ?? 0.7;
    this.musicVolume = settings?.musicVolume ?? 0.4;
    this.backend = new SilentAudioBackend();

    if (factory) {
      const ctx = factory();
      if (ctx) {
        this.context = ctx;
        this.backend = new WebAudioBackend(ctx);
      }
    }

    this.events.on('audio:play', ({ cue, volume }) => {
      if (cue in CUES) this.play(cue as AudioCue, { volume });
    });
    this.events.on('audio:settings', (payload) => this.setVolumes(payload.sfx, payload.music));
  }

  /** Ленивая инициализация аудиоконтекста из браузера (нужен жест пользователя). */
  attachBrowserContext(): boolean {
    if (this.context) return true;
    type AudioContextCtor = new () => AudioContext;
    type GlobalWithAudio = typeof globalThis & {
      AudioContext?: AudioContextCtor;
      webkitAudioContext?: AudioContextCtor;
    };
    const w = globalThis as GlobalWithAudio;
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return false;
    try {
      this.context = new Ctor() as unknown as AudioContextLike;
      this.backend = new WebAudioBackend(this.context);
      return true;
    } catch {
      return false;
    }
  }

  get isRealAudio(): boolean {
    return this.context !== null;
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = clamp01(sfx);
    this.musicVolume = clamp01(music);
    if (this.context && this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Порог частоты: не более одного одинакового звука за 40 мс. */
  private throttle(cue: AudioCue, minGapMs: number): boolean {
    const now = Date.now();
    const last = this.lastPlayedAt.get(cue);
    if (last !== undefined && now - last < minGapMs) return true;
    this.lastPlayedAt.set(cue, now);
    return false;
  }

  play(cue: AudioCue, options: PlayOptions & { throttleMs?: number } = {}): void {
    if (this.muted) return;
    if (options.throttleMs !== undefined && this.throttle(cue, options.throttleMs)) return;
    const volume = (options.volume ?? 1) * this.sfxVolume;
    if (volume <= 0.001) return;
    this.backend.play(cue, volume, options.pitch ?? 1);
  }

  /** Фоновая «музыка»: низкочастотный гул производственной площадки. */
  startMusic(): void {
    if (!this.context || this.musicSource) return;
    const ctx = this.context;
    this.musicBuffer ??= renderBuffer(ctx.sampleRate, 4, {
      type: 'noise',
      frequency: 0,
      duration: 4,
      decay: 0.05,
      gain: 0.16,
      seed: 99,
    });
    const source = ctx.createBufferSource();
    source.buffer = this.musicBuffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = this.musicVolume * 0.35;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(ctx.currentTime);
    this.musicSource = source as unknown as { stop: (t?: number) => void };
  }

  stopMusic(): void {
    if (this.musicSource) {
      try {
        this.musicSource.stop();
      } catch {
        /* уже остановлен */
      }
      this.musicSource = null;
    }
  }

  dispose(): void {
    this.stopMusic();
    this.backend.dispose();
    this.context = null;
  }

  /** История воспроизведения — используется в тестах. */
  get history(): readonly { cue: AudioCue; volume: number; pitch: number }[] {
    return this.backend instanceof SilentAudioBackend ? this.backend.played : [];
  }

  /** Список доступных событий для документации и UI. */
  static cues(): readonly AudioCue[] {
    return Object.keys(CUES) as AudioCue[];
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
