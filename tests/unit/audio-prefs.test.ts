import { describe, it, expect } from 'vitest';
import { PREFS_STORAGE_KEY, validatePrefs } from '../../src/audio-prefs';

describe('PREFS_STORAGE_KEY', () => {
  it('is a stable, namespaced string', () => {
    expect(PREFS_STORAGE_KEY).toBe('mma-audio-prefs');
  });
});

describe('validatePrefs', () => {
  it('returns an empty object for null / undefined / non-object inputs', () => {
    expect(validatePrefs(null)).toEqual({});
    expect(validatePrefs(undefined)).toEqual({});
    expect(validatePrefs('not an object')).toEqual({});
    expect(validatePrefs(42)).toEqual({});
    expect(validatePrefs(true)).toEqual({});
  });

  it('extracts a valid ambientEnabled boolean', () => {
    expect(validatePrefs({ ambientEnabled: true })).toEqual({ ambientEnabled: true });
    expect(validatePrefs({ ambientEnabled: false })).toEqual({ ambientEnabled: false });
  });

  it('drops ambientEnabled when not a boolean', () => {
    expect(validatePrefs({ ambientEnabled: 'true' })).toEqual({});
    expect(validatePrefs({ ambientEnabled: 1 })).toEqual({});
    expect(validatePrefs({ ambientEnabled: null })).toEqual({});
  });

  it('extracts volumes inside [0, 1]', () => {
    expect(validatePrefs({ masterVolume: 0, ambientVolume: 1 })).toEqual({
      masterVolume: 0,
      ambientVolume: 1,
    });
    expect(validatePrefs({ masterVolume: 0.42, ambientVolume: 0.78 })).toEqual({
      masterVolume: 0.42,
      ambientVolume: 0.78,
    });
  });

  it('drops volumes outside [0, 1]', () => {
    expect(validatePrefs({ masterVolume: -0.1 })).toEqual({});
    expect(validatePrefs({ masterVolume: 1.0001 })).toEqual({});
    expect(validatePrefs({ ambientVolume: -1 })).toEqual({});
    expect(validatePrefs({ ambientVolume: 2 })).toEqual({});
  });

  it('drops volumes that are NaN / Infinity / non-numeric', () => {
    expect(validatePrefs({ masterVolume: Number.NaN })).toEqual({});
    expect(validatePrefs({ masterVolume: Number.POSITIVE_INFINITY })).toEqual({});
    expect(validatePrefs({ ambientVolume: 'loud' })).toEqual({});
    expect(validatePrefs({ ambientVolume: null })).toEqual({});
  });

  it('ignores unknown fields (mute is not persisted)', () => {
    expect(validatePrefs({ muted: true, ambientEnabled: true, foo: 'bar' })).toEqual({
      ambientEnabled: true,
    });
  });

  it('returns only the valid subset when some fields are bad', () => {
    expect(validatePrefs({
      ambientEnabled: true,
      masterVolume: 0.5,
      ambientVolume: 9999,
    })).toEqual({
      ambientEnabled: true,
      masterVolume: 0.5,
    });
  });

  it('never throws on hostile input', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => validatePrefs(cyclic)).not.toThrow();
    expect(() => validatePrefs([])).not.toThrow();
    expect(() => validatePrefs(Symbol('x'))).not.toThrow();
  });
});
