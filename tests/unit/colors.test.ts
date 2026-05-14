import { describe, it, expect } from 'vitest';
import { COLOR_DECAYED, COLOR_HEALTHY, healthColor, lerp, lerpColor } from '../../src/colors';

describe('lerp', () => {
  it('returns endpoints at t=0 and t=1', () => {
    expect(lerp(0, 100, 0)).toBe(0);
    expect(lerp(0, 100, 1)).toBe(100);
  });
  it('interpolates linearly', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });
});

describe('lerpColor', () => {
  it('returns c1 at t=0 and c2 at t=1', () => {
    expect(lerpColor(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(lerpColor(0x000000, 0xffffff, 1)).toBe(0xffffff);
  });
  it('interpolates each channel independently', () => {
    // 50% between red and blue -> half red, half blue, no green.
    // Math.round(127.5) === 128 in JS, so both channels round up to 0x80.
    expect(lerpColor(0xff0000, 0x0000ff, 0.5)).toBe(0x800080);
  });
});

describe('healthColor', () => {
  it('full health -> COLOR_HEALTHY', () => {
    expect(healthColor(1)).toBe(COLOR_HEALTHY);
  });
  it('no health -> COLOR_DECAYED', () => {
    expect(healthColor(0)).toBe(COLOR_DECAYED);
  });
  it('clamps out-of-range inputs', () => {
    expect(healthColor(-1)).toBe(COLOR_DECAYED);
    expect(healthColor(2)).toBe(COLOR_HEALTHY);
  });
  it('mid health is between the endpoints', () => {
    const mid = healthColor(0.5);
    expect(mid).not.toBe(COLOR_HEALTHY);
    expect(mid).not.toBe(COLOR_DECAYED);
  });
});
