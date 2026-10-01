import { describe, expect, it } from 'vitest';

import {
  clamp,
  damp,
  distance,
  formatMass,
  formatPercent,
  formatTime,
  inverseLerp,
  lerp,
  normalize,
  pointInExpandedRect,
  pointInRect,
  smoothStep,
} from '../../src/core/MathUtils';

describe('MathUtils', () => {
  it('clamp ограничивает значение по границам', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('lerp и inverseLerp обратны друг другу', () => {
    expect(lerp(0, 10, 0.25)).toBeCloseTo(2.5, 6);
    expect(inverseLerp(0, 10, 2.5)).toBeCloseTo(0.25, 6);
  });

  it('normalize возвращает единичный вектор и не падает на нуле', () => {
    const n = normalize(3, 4);
    expect(n.x).toBeCloseTo(0.6, 6);
    expect(n.y).toBeCloseTo(0.8, 6);

    const zero = normalize(0, 0);
    expect(zero.x).toBe(0);
    expect(zero.y).toBe(0);
  });

  it('distance считает евклидово расстояние', () => {
    expect(distance(0, 0, 3, 4)).toBe(5);
  });

  it('pointInRect уважает границы', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(pointInRect(5, 5, rect)).toBe(true);
    expect(pointInRect(-1, 5, rect)).toBe(false);
    expect(pointInRect(11, 5, rect)).toBe(false);
  });

  it('pointInExpandedRect расширяет прямоугольник на заданный отступ', () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(pointInExpandedRect(12, 5, rect, 3)).toBe(true);
    expect(pointInExpandedRect(14, 5, rect, 3)).toBe(false);
  });

  it('smoothStep даёт S-образную кривую на [0,1]', () => {
    expect(smoothStep(0)).toBeCloseTo(0, 6);
    expect(smoothStep(1)).toBeCloseTo(1, 6);
    expect(smoothStep(0.5)).toBeCloseTo(0.5, 6);
    expect(smoothStep(0.25)).toBeLessThan(0.25);
  });

  it('damp стремится к цели, но не прыгает к ней', () => {
    const next = damp(0, 10, 0.1, 1);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(10);
    expect(damp(0, 10, 0.001, 1)).toBeGreaterThan(next);
  });

  it('форматтеры выдают читаемые строки', () => {
    expect(formatMass(1234)).toBe('1.23 т');
    expect(formatMass(320)).toBe('320 кг');
    // formatPercent принимает уже готовые проценты, а не долю.
    expect(formatPercent(45.6, 1)).toBe('45.6%');
    expect(formatPercent(45.6)).toBe('46%');
    expect(formatTime(95)).toBe('1:35');
    expect(formatTime(-4)).toBe('0:00');
  });
});
