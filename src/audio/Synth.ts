/**
 * Процедурный синтез звука. Никаких внешних аудиофайлов: короткие сигналы
 * строятся из осцилляторов и шума, поэтому лицензионно чисты и весят ноль байт.
 */

export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'noise';

export interface ToneOptions {
  readonly type: Waveform;
  readonly frequency: number;
  readonly duration: number;
  readonly gain?: number;
  /** Линейная девиация частоты: freq + sweep * t. */
  readonly sweep?: number;
  /** Экспоненциальное затухание. */
  readonly decay?: number;
  readonly attack?: number;
  /** Сид ГПСЧ для шумовых сигналов: делает звук воспроизводимым. */
  readonly seed?: number;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly destination: never;
  readonly state: string;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBufferSource(): BufferSourceNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  resume(): Promise<void>;
}

export interface GainNodeLike {
  gain: { value: number };
  connect(destination: unknown): unknown;
  disconnect(): void;
}

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
  exponentialRampToValueAtTime(value: number, time: number): void;
}

export interface OscillatorNodeLike {
  frequency: AudioParamLike;
  type: string;
  connect(destination: unknown): unknown;
  disconnect(): void;
  start(time?: number): void;
  stop(time?: number): void;
}

export interface AudioBufferLike {
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

export interface BufferSourceNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  connect(destination: unknown): unknown;
  disconnect(): void;
  start(time?: number): void;
  stop(time?: number): void;
}

/** Простой детерминированный ГПСЧ, чтобы звук был воспроизводим в тестах. */
export function makeRng(seed = 1337): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Генерация PCM-буфера заданной длительности. */
export function renderBuffer(
  sampleRate: number,
  duration: number,
  options: ToneOptions = { type: 'sine', frequency: 220, duration: 1 },
): AudioBufferLike {
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const data = new Float32Array(length);
  const rng = makeRng(options.seed ?? 42);
  const gain = options.gain ?? 0.6;
  const decay = options.decay ?? 4;
  const attack = options.attack ?? 0.005;
  const sweep = options.sweep ?? 0;
  let noiseState = 0;

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const freq = options.frequency + sweep * t;
    let sample: number;
    switch (options.type) {
      case 'square':
        sample = Math.sign(Math.sin(2 * Math.PI * freq * t)) || 1;
        break;
      case 'sawtooth':
        sample = 2 * ((freq * t) % 1) - 1;
        break;
      case 'triangle':
        sample = 2 * Math.abs(2 * ((freq * t) % 1) - 1) - 1;
        break;
      case 'noise':
        noiseState = 0.7 * noiseState + 0.3 * (rng() * 2 - 1);
        sample = noiseState;
        break;
      case 'sine':
      default:
        sample = Math.sin(2 * Math.PI * freq * t);
        break;
    }
    const envelope = Math.min(1, t / Math.max(attack, 1e-4)) * Math.exp(-decay * t);
    data[i] = sample * envelope * gain;
  }

  return {
    sampleRate,
    getChannelData: () => data,
  };
}

export interface WavSample {
  readonly sampleRate: number;
  readonly samples: Float32Array;
}

export function renderWav(tone: ToneOptions): WavSample {
  const sampleRate = 22050;
  const buffer = renderBuffer(sampleRate, tone.duration, tone);
  return { sampleRate, samples: buffer.getChannelData(0) };
}

/** Конвертация сэмпла в WAV (16-bit PCM) — используется в тестах и отладке. */
export function toWavBase64(sample: WavSample): string {
  const { samples, sampleRate } = sample;
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * bytesPerSample, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}
