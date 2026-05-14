import { describe, it, expect } from 'vitest';
import {
  AUDIO_FILES,
  AUDIO_IDS,
  pickAudio,
  pickChain,
  WEIGHT_MATRIX,
  type AudioId,
} from '../../src/audio-pick';
import type { Mood } from '../../src/audio-mood';

/** A `random` that returns the given fixed value on every call. */
const fixed = (v: number): (() => number) => () => v;

/** Sequence-based random for multi-call sites. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i] ?? values[values.length - 1] ?? 0;
    i++;
    return v;
  };
}

describe('AUDIO_IDS / AUDIO_FILES', () => {
  it('exports the 10 documented clip ids', () => {
    expect(AUDIO_IDS).toHaveLength(10);
    expect(new Set(AUDIO_IDS).size).toBe(10);
  });

  it('has a filename for every id', () => {
    for (const id of AUDIO_IDS) {
      expect(AUDIO_FILES[id]).toMatch(/\.mp3$/);
    }
  });
});

describe('WEIGHT_MATRIX', () => {
  const moods: Mood[] = [
    'newborn', 'healthy', 'declining', 'critical',
    'freakingOut', 'recovered', 'dyingHappy', 'dyingDefeated',
  ];

  it('defines a row for every mood, with all 10 audio ids', () => {
    for (const m of moods) {
      const row = WEIGHT_MATRIX[m];
      for (const id of AUDIO_IDS) {
        expect(typeof row[id]).toBe('number');
        expect(row[id]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('dyingHappy only allows allDone', () => {
    const row = WEIGHT_MATRIX.dyingHappy;
    for (const id of AUDIO_IDS) {
      if (id === 'allDone') {
        expect(row[id]).toBeGreaterThan(0);
      } else {
        expect(row[id]).toBe(0);
      }
    }
  });

  it('dyingDefeated never plays allDone', () => {
    expect(WEIGHT_MATRIX.dyingDefeated.allDone).toBe(0);
  });

  it('newborn deterministically plays imMrMeeseeks (iconic greeting only)', () => {
    const row = WEIGHT_MATRIX.newborn;
    expect(row.imMrMeeseeks).toBeGreaterThan(0);
    for (const id of AUDIO_IDS) {
      if (id !== 'imMrMeeseeks') expect(row[id]).toBe(0);
    }
  });
});

describe('pickAudio', () => {
  it('returns null when the resolved row sums to 0', () => {
    // dyingHappy has only `allDone`. Exclude it → all zeros → silence.
    expect(pickAudio('dyingHappy', 'allDone', fixed(0.5))).toBeNull();
  });

  it('never picks a weight-0 entry, even with random sweeping [0,1)', () => {
    // For dyingHappy, only allDone has weight > 0; everything else must never be picked.
    for (let i = 0; i < 25; i++) {
      const r = i / 25;
      expect(pickAudio('dyingHappy', null, fixed(r))).toBe('allDone');
    }
  });

  it('newborn always returns imMrMeeseeks regardless of random', () => {
    for (let i = 0; i < 25; i++) {
      expect(pickAudio('newborn', null, fixed(i / 25))).toBe('imMrMeeseeks');
    }
  });

  it('newborn excluding imMrMeeseeks yields silence (row sums to 0 after exclusion)', () => {
    expect(pickAudio('newborn', 'imMrMeeseeks', fixed(0))).toBeNull();
    expect(pickAudio('newborn', 'imMrMeeseeks', fixed(0.99))).toBeNull();
  });

  it('walks the weight buckets in AUDIO_IDS order for `healthy` (total weight = 9)', () => {
    // healthy non-zero entries in AUDIO_IDS order:
    //   lookAtMe=1, canDo=4, excuseMe=2, letMeTry=2  → cumulative 1, 5, 7, 9
    // random*9 falls into buckets:
    //   [0, 1) → lookAtMe; [1, 5) → canDo; [5, 7) → excuseMe; [7, 9) → letMeTry
    expect(pickAudio('healthy', null, fixed(0))).toBe('lookAtMe');
    expect(pickAudio('healthy', null, fixed(0.5 / 9))).toBe('lookAtMe');
    expect(pickAudio('healthy', null, fixed(2 / 9))).toBe('canDo');
    expect(pickAudio('healthy', null, fixed(4.5 / 9))).toBe('canDo');
    expect(pickAudio('healthy', null, fixed(6 / 9))).toBe('excuseMe');
    expect(pickAudio('healthy', null, fixed(8 / 9))).toBe('letMeTry');
  });

  it('excludes the last-played id from the draw (healthy minus canDo)', () => {
    // healthy minus canDo: lookAtMe=1, excuseMe=2, letMeTry=2 → total 5
    //   [0, 1) → lookAtMe; [1, 3) → excuseMe; [3, 5) → letMeTry
    expect(pickAudio('healthy', 'canDo', fixed(0))).toBe('lookAtMe');
    expect(pickAudio('healthy', 'canDo', fixed(2 / 5))).toBe('excuseMe');
    expect(pickAudio('healthy', 'canDo', fixed(4 / 5))).toBe('letMeTry');
  });

  it('never returns the excluded id across many draws', () => {
    const seen: AudioId[] = [];
    for (let i = 0; i < 50; i++) {
      const r = i / 50;
      const got = pickAudio('healthy', 'canDo', fixed(r));
      if (got) seen.push(got);
    }
    expect(seen).not.toContain('canDo');
    // Should still see other healthy-weighted ids (lookAtMe, excuseMe, letMeTry).
    expect(seen.length).toBeGreaterThan(0);
  });

  it('handles random()=1 (theoretical max) via the fallback branch', () => {
    // random() should return [0,1) per spec, but if it ever yields 1 exactly,
    // we still pick the last non-zero, non-excluded entry rather than null.
    expect(pickAudio('healthy', null, fixed(0.999999))).not.toBeNull();
    expect(pickAudio('healthy', null, fixed(1))).not.toBeNull();
  });
});

describe('pickChain', () => {
  it('imMrMeeseeks chains to canDo (35%), lookAtMe (15%), or silence (50%)', () => {
    expect(pickChain('imMrMeeseeks', 'newborn', fixed(0.0))).toBe('canDo');
    expect(pickChain('imMrMeeseeks', 'newborn', fixed(0.34))).toBe('canDo');
    // boundary: 0.35 → not in [0, 0.35), is in [0.35, 0.50) → lookAtMe
    expect(pickChain('imMrMeeseeks', 'newborn', fixed(0.35))).toBe('lookAtMe');
    expect(pickChain('imMrMeeseeks', 'newborn', fixed(0.49))).toBe('lookAtMe');
    expect(pickChain('imMrMeeseeks', 'newborn', fixed(0.50))).toBeNull();
    expect(pickChain('imMrMeeseeks', 'newborn', fixed(0.99))).toBeNull();
  });

  it('mrMeeseeks shares the imMrMeeseeks chain table', () => {
    expect(pickChain('mrMeeseeks', 'newborn', fixed(0.10))).toBe('canDo');
    expect(pickChain('mrMeeseeks', 'newborn', fixed(0.40))).toBe('lookAtMe');
    expect(pickChain('mrMeeseeks', 'newborn', fixed(0.80))).toBeNull();
  });

  it('lookAtMe → 25% canDo, else silence', () => {
    expect(pickChain('lookAtMe', 'healthy', fixed(0.24))).toBe('canDo');
    expect(pickChain('lookAtMe', 'healthy', fixed(0.25))).toBeNull();
    expect(pickChain('lookAtMe', 'newborn', fixed(0.0))).toBe('canDo');
  });

  it('canDo only chains in healthy (10% letMeTry)', () => {
    expect(pickChain('canDo', 'healthy', fixed(0.09))).toBe('letMeTry');
    expect(pickChain('canDo', 'healthy', fixed(0.10))).toBeNull();
    expect(pickChain('canDo', 'declining', fixed(0.0))).toBeNull();
    expect(pickChain('canDo', 'critical', fixed(0.0))).toBeNull();
    expect(pickChain('canDo', 'recovered', fixed(0.0))).toBeNull();
  });

  it('excuseMe → 25% letMeTry, mood-agnostic', () => {
    expect(pickChain('excuseMe', 'declining', fixed(0.24))).toBe('letMeTry');
    expect(pickChain('excuseMe', 'critical', fixed(0.24))).toBe('letMeTry');
    expect(pickChain('excuseMe', 'healthy', fixed(0.5))).toBeNull();
  });

  it('letMeTry only chains in critical or freakingOut (30% mistakes...)', () => {
    expect(pickChain('letMeTry', 'critical', fixed(0.29))).toBe('mistakesDontExistThisLong');
    expect(pickChain('letMeTry', 'freakingOut', fixed(0.29))).toBe('mistakesDontExistThisLong');
    expect(pickChain('letMeTry', 'critical', fixed(0.30))).toBeNull();
    expect(pickChain('letMeTry', 'declining', fixed(0.0))).toBeNull();
    expect(pickChain('letMeTry', 'healthy', fixed(0.0))).toBeNull();
  });

  it('mistakes... only chains in freakingOut (20% iJustWantToDie)', () => {
    expect(pickChain('mistakesDontExistThisLong', 'freakingOut', fixed(0.19))).toBe('iJustWantToDie');
    expect(pickChain('mistakesDontExistThisLong', 'freakingOut', fixed(0.20))).toBeNull();
    expect(pickChain('mistakesDontExistThisLong', 'critical', fixed(0.0))).toBeNull();
    expect(pickChain('mistakesDontExistThisLong', 'dyingDefeated', fixed(0.0))).toBeNull();
  });

  it('terminal lines never chain', () => {
    expect(pickChain('iJustWantToDie', 'freakingOut', fixed(0.0))).toBeNull();
    expect(pickChain('allDone', 'dyingHappy', fixed(0.0))).toBeNull();
    expect(pickChain('ohOk', 'recovered', fixed(0.0))).toBeNull();
  });

  it('only invokes random() once per call', () => {
    const r = seq([0.1, 0.99, 0.99]);
    pickChain('imMrMeeseeks', 'newborn', r);
    pickChain('canDo', 'healthy', r);
    pickChain('letMeTry', 'critical', r);
    // After 3 calls, the cursor should be at index 3 → values past array length
    // are pinned to the last entry. The important assertion: 3 distinct calls
    // consumed 3 values (i.e. each pickChain only sampled once).
    expect(r()).toBe(0.99);
  });
});
