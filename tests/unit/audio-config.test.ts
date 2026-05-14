import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_AUDIO_CONFIG, parseAudioConfig } from '../../src/audio-config';

describe('parseAudioConfig', () => {
  it('returns documented defaults when env is empty', () => {
    const cfg = parseAudioConfig({});
    expect(cfg).toEqual(DEFAULT_AUDIO_CONFIG);
  });

  it('returns defaults when env is undefined', () => {
    const cfg = parseAudioConfig(undefined);
    expect(cfg.defaultMuted).toBe(true);
    expect(cfg.pitchOffsets).toEqual([0.92, 1.0, 1.08]);
  });

  it('parses boolean flags (true/false/1/0/yes/no, case-insensitive)', () => {
    const warn = vi.fn();
    expect(parseAudioConfig({ VITE_AUDIO_DEFAULT_MUTED: 'false' }, warn).defaultMuted).toBe(false);
    expect(parseAudioConfig({ VITE_AUDIO_DEFAULT_MUTED: 'TRUE' }, warn).defaultMuted).toBe(true);
    expect(parseAudioConfig({ VITE_AUDIO_DEFAULT_MUTED: '0' }, warn).defaultMuted).toBe(false);
    expect(parseAudioConfig({ VITE_AUDIO_DEFAULT_MUTED: 'yes' }, warn).defaultMuted).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back and warns on a malformed boolean', () => {
    const warn = vi.fn();
    const cfg = parseAudioConfig({ VITE_AUDIO_DEFAULT_MUTED: 'maybe' }, warn);
    expect(cfg.defaultMuted).toBe(DEFAULT_AUDIO_CONFIG.defaultMuted);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/VITE_AUDIO_DEFAULT_MUTED/);
  });

  it('parses a comma-separated number list for pitch offsets', () => {
    const cfg = parseAudioConfig({ VITE_AUDIO_PITCH_OFFSETS: '0.8, 1.0 , 1.2,1.4' });
    expect(cfg.pitchOffsets).toEqual([0.8, 1.0, 1.2, 1.4]);
  });

  it('falls back on an empty pitch list', () => {
    const warn = vi.fn();
    const cfg = parseAudioConfig({ VITE_AUDIO_PITCH_OFFSETS: '   ' }, warn);
    expect(cfg.pitchOffsets).toEqual(DEFAULT_AUDIO_CONFIG.pitchOffsets);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('falls back when any pitch entry is unparseable', () => {
    const warn = vi.fn();
    const cfg = parseAudioConfig({ VITE_AUDIO_PITCH_OFFSETS: '0.9,banana,1.1' }, warn);
    expect(cfg.pitchOffsets).toEqual(DEFAULT_AUDIO_CONFIG.pitchOffsets);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('falls back when a pitch entry is non-positive (zero is invalid for playbackRate)', () => {
    const warn = vi.fn();
    const cfg = parseAudioConfig({ VITE_AUDIO_PITCH_OFFSETS: '0.9,0,1.1' }, warn);
    expect(cfg.pitchOffsets).toEqual(DEFAULT_AUDIO_CONFIG.pitchOffsets);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('parses cadence values in seconds', () => {
    const cfg = parseAudioConfig({
      VITE_AUDIO_COOLDOWN_S: '1.5',
      VITE_AUDIO_CHAIN_COOLDOWN_S: '5',
      VITE_AUDIO_AMBIENT_TICK_S: '3',
      VITE_AUDIO_NEWBORN_LOCK_S: '0.8',
      VITE_AUDIO_RECOVERED_LOCK_S: '2.2',
    });
    expect(cfg.cooldownS).toBe(1.5);
    expect(cfg.chainCooldownS).toBe(5);
    expect(cfg.ambientTickS).toBe(3);
    expect(cfg.newbornLockS).toBe(0.8);
    expect(cfg.recoveredLockS).toBe(2.2);
  });

  it('allows zero for lock durations (non-negative) but rejects negative', () => {
    const warn = vi.fn();
    const okCfg = parseAudioConfig({ VITE_AUDIO_NEWBORN_LOCK_S: '0' }, warn);
    expect(okCfg.newbornLockS).toBe(0);
    expect(warn).not.toHaveBeenCalled();

    const badCfg = parseAudioConfig({ VITE_AUDIO_NEWBORN_LOCK_S: '-1' }, warn);
    expect(badCfg.newbornLockS).toBe(DEFAULT_AUDIO_CONFIG.newbornLockS);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('rejects zero / negative for strictly-positive durations (ambient tick)', () => {
    const warn = vi.fn();
    const cfg = parseAudioConfig({ VITE_AUDIO_AMBIENT_TICK_S: '0' }, warn);
    expect(cfg.ambientTickS).toBe(DEFAULT_AUDIO_CONFIG.ambientTickS);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('parses positive ints for caps; rejects non-integers and non-positives', () => {
    const warn = vi.fn();
    expect(parseAudioConfig({ VITE_AUDIO_BIRTH_BURST_CAP: '5' }, warn).birthBurstCap).toBe(5);
    expect(parseAudioConfig({ VITE_AUDIO_CONCURRENT_CAP: '8' }, warn).concurrentCap).toBe(8);
    expect(warn).not.toHaveBeenCalled();

    const cfg = parseAudioConfig(
      {
        VITE_AUDIO_BIRTH_BURST_CAP: '2.5',
        VITE_AUDIO_CONCURRENT_CAP: '0',
      },
      warn,
    );
    expect(cfg.birthBurstCap).toBe(DEFAULT_AUDIO_CONFIG.birthBurstCap);
    expect(cfg.concurrentCap).toBe(DEFAULT_AUDIO_CONFIG.concurrentCap);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('never throws on garbage input', () => {
    expect(() =>
      parseAudioConfig(
        {
          VITE_AUDIO_DEFAULT_MUTED: '??',
          VITE_AUDIO_PITCH_OFFSETS: ',,,',
          VITE_AUDIO_BIRTH_BURST_CAP: 'NaN',
          VITE_AUDIO_BIRTH_BURST_WINDOW_MS: 'foo',
          VITE_AUDIO_COOLDOWN_S: 'nope',
          VITE_AUDIO_CONCURRENT_CAP: '-3',
          VITE_AUDIO_AMBIENT_ENABLED: 'sometimes',
          VITE_AUDIO_MASTER_VOLUME: '11',
          VITE_AUDIO_AMBIENT_VOLUME: 'banana',
        },
        () => {},
      ),
    ).not.toThrow();
  });

  describe('ambient + volume mix', () => {
    it('defaults: ambient enabled, master 1.0, ambient 0.4', () => {
      const cfg = parseAudioConfig({});
      expect(cfg.ambientEnabled).toBe(true);
      expect(cfg.masterVolume).toBe(1.0);
      expect(cfg.ambientVolume).toBe(0.4);
    });

    it('parses VITE_AUDIO_AMBIENT_ENABLED as a boolean', () => {
      expect(parseAudioConfig({ VITE_AUDIO_AMBIENT_ENABLED: 'false' }).ambientEnabled).toBe(false);
      expect(parseAudioConfig({ VITE_AUDIO_AMBIENT_ENABLED: 'no' }).ambientEnabled).toBe(false);
      expect(parseAudioConfig({ VITE_AUDIO_AMBIENT_ENABLED: 'true' }).ambientEnabled).toBe(true);
    });

    it('accepts valid fractions for the volumes', () => {
      const cfg = parseAudioConfig({
        VITE_AUDIO_MASTER_VOLUME: '0.5',
        VITE_AUDIO_AMBIENT_VOLUME: '0',
      });
      expect(cfg.masterVolume).toBe(0.5);
      expect(cfg.ambientVolume).toBe(0);
    });

    it('accepts the boundaries 0 and 1', () => {
      const lo = parseAudioConfig({
        VITE_AUDIO_MASTER_VOLUME: '0',
        VITE_AUDIO_AMBIENT_VOLUME: '0',
      });
      expect(lo.masterVolume).toBe(0);
      expect(lo.ambientVolume).toBe(0);
      const hi = parseAudioConfig({
        VITE_AUDIO_MASTER_VOLUME: '1',
        VITE_AUDIO_AMBIENT_VOLUME: '1',
      });
      expect(hi.masterVolume).toBe(1);
      expect(hi.ambientVolume).toBe(1);
    });

    it('falls back when a volume is out of [0, 1] (negative or > 1)', () => {
      const warn = vi.fn();
      const cfg = parseAudioConfig(
        {
          VITE_AUDIO_MASTER_VOLUME: '-0.1',
          VITE_AUDIO_AMBIENT_VOLUME: '1.5',
        },
        warn,
      );
      expect(cfg.masterVolume).toBe(1.0);
      expect(cfg.ambientVolume).toBe(0.4);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('falls back when a volume is non-numeric', () => {
      const warn = vi.fn();
      const cfg = parseAudioConfig(
        {
          VITE_AUDIO_MASTER_VOLUME: 'banana',
          VITE_AUDIO_AMBIENT_VOLUME: 'NaN',
        },
        warn,
      );
      expect(cfg.masterVolume).toBe(1.0);
      expect(cfg.ambientVolume).toBe(0.4);
      expect(warn).toHaveBeenCalledTimes(2);
    });
  });
});
