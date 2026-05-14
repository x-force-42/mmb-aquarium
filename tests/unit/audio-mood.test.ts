import { describe, it, expect } from 'vitest';
import { deriveMood, type MoodInput } from '../../src/audio-mood';

/** Defaults a fresh, healthy Meeseeks well past every lock. */
function input(over: Partial<MoodInput> = {}): MoodInput {
  return {
    health: 1,
    isFreakingOut: false,
    nowMs: 100_000,
    bornAtMs: 0,
    recoveredAtMs: null,
    newbornLockMs: 1500,
    recoveredLockMs: 1500,
    ...over,
  };
}

describe('deriveMood', () => {
  describe('health-band moods (locks expired)', () => {
    it('health > 0.7 → healthy', () => {
      expect(deriveMood(input({ health: 0.71 }))).toBe('healthy');
      expect(deriveMood(input({ health: 1 }))).toBe('healthy');
    });

    it('health == 0.7 → declining (boundary)', () => {
      expect(deriveMood(input({ health: 0.7 }))).toBe('declining');
    });

    it('0.4 < health <= 0.7 → declining', () => {
      expect(deriveMood(input({ health: 0.41 }))).toBe('declining');
      expect(deriveMood(input({ health: 0.5 }))).toBe('declining');
      expect(deriveMood(input({ health: 0.69 }))).toBe('declining');
    });

    it('health == 0.4 → critical (boundary)', () => {
      expect(deriveMood(input({ health: 0.4 }))).toBe('critical');
    });

    it('health <= 0.4 → critical', () => {
      expect(deriveMood(input({ health: 0.0 }))).toBe('critical');
      expect(deriveMood(input({ health: 0.39 }))).toBe('critical');
    });
  });

  describe('newborn lock', () => {
    it('sinceBorn=0 → newborn (regardless of health band)', () => {
      expect(deriveMood(input({ nowMs: 0, bornAtMs: 0, health: 0.1 }))).toBe('newborn');
    });

    it('sinceBorn < newbornLockMs → newborn', () => {
      expect(deriveMood(input({ nowMs: 1499, bornAtMs: 0 }))).toBe('newborn');
    });

    it('sinceBorn == newbornLockMs → drops out of newborn', () => {
      expect(deriveMood(input({ nowMs: 1500, bornAtMs: 0, health: 1 }))).toBe('healthy');
    });

    it('newborn lock wins over freakingOut and health', () => {
      expect(
        deriveMood(
          input({
            nowMs: 100,
            bornAtMs: 0,
            isFreakingOut: true,
            health: 0.1,
          }),
        ),
      ).toBe('newborn');
    });

    it('respects a custom lock duration via input', () => {
      expect(
        deriveMood(
          input({
            nowMs: 700,
            bornAtMs: 0,
            newbornLockMs: 600,
            health: 1,
          }),
        ),
      ).toBe('healthy');
      expect(
        deriveMood(
          input({
            nowMs: 599,
            bornAtMs: 0,
            newbornLockMs: 600,
            health: 0.1,
          }),
        ),
      ).toBe('newborn');
    });
  });

  describe('freakingOut', () => {
    it('isFreakingOut=true wins over every health band when lock expired', () => {
      expect(deriveMood(input({ isFreakingOut: true, health: 1 }))).toBe('freakingOut');
      expect(deriveMood(input({ isFreakingOut: true, health: 0 }))).toBe('freakingOut');
    });

    it('freakingOut wins over recovered lock when both are set (re-entering freak after a recover)', () => {
      // Got recovered 100ms ago, now isFreakingOut is true again → freakingOut.
      expect(
        deriveMood(
          input({
            isFreakingOut: true,
            recoveredAtMs: 99_900,
            nowMs: 100_000,
            health: 1,
          }),
        ),
      ).toBe('freakingOut');
    });
  });

  describe('recovered lock', () => {
    it('within lock window, isFreakingOut=false → recovered', () => {
      expect(
        deriveMood(
          input({
            isFreakingOut: false,
            recoveredAtMs: 100_000,
            nowMs: 100_500,
            health: 0.2,
          }),
        ),
      ).toBe('recovered');
    });

    it('recovered lock wins over critical/declining/healthy', () => {
      expect(
        deriveMood(
          input({
            isFreakingOut: false,
            recoveredAtMs: 100_000,
            nowMs: 100_999,
            health: 1,
          }),
        ),
      ).toBe('recovered');
      expect(
        deriveMood(
          input({
            isFreakingOut: false,
            recoveredAtMs: 100_000,
            nowMs: 100_999,
            health: 0,
          }),
        ),
      ).toBe('recovered');
    });

    it('recovered window expires after recoveredLockMs', () => {
      expect(
        deriveMood(
          input({
            isFreakingOut: false,
            recoveredAtMs: 100_000,
            nowMs: 101_500,
            health: 1,
          }),
        ),
      ).toBe('healthy');
    });

    it('null recoveredAtMs never enters recovered mood', () => {
      expect(
        deriveMood(
          input({
            isFreakingOut: false,
            recoveredAtMs: null,
            health: 0.2,
          }),
        ),
      ).toBe('critical');
    });
  });
});
