/**
 * Color math, isolated so it's trivially unit-testable.
 * Pixi tints use 0xRRGGBB integers — same encoding we use here.
 */

export const COLOR_HEALTHY = 0x4a90e2; // vibrant blue
export const COLOR_DECAYED = 0x8a8a8a; // muted gray (health -> 0)
export const COLOR_FREAK = 0xe74c3c; // red, for freak-out pulse
export const COLOR_HAPPY = 0xf5c542; // gold, for happy death
export const COLOR_DEFEATED = 0x6e6e6e; // dim gray, for defeated death

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Channel-wise linear interpolation between two 0xRRGGBB colors. */
export function lerpColor(c1: number, c2: number, t: number): number {
  const r = Math.round(lerp((c1 >> 16) & 0xff, (c2 >> 16) & 0xff, t));
  const g = Math.round(lerp((c1 >> 8) & 0xff, (c2 >> 8) & 0xff, t));
  const b = Math.round(lerp(c1 & 0xff, c2 & 0xff, t));
  return (r << 16) | (g << 8) | b;
}

/** health=1 -> healthy color, health=0 -> decayed color. Clamps internally. */
export function healthColor(
  health: number,
  palette?: { healthy: number; decayed: number },
): number {
  const healthy = palette?.healthy ?? COLOR_HEALTHY;
  const decayed = palette?.decayed ?? COLOR_DECAYED;
  const t = 1 - Math.max(0, Math.min(1, health));
  return lerpColor(healthy, decayed, t);
}
