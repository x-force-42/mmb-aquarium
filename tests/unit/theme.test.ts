import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyTheme,
  getActiveMode,
  getActivePalette,
  initTheme,
  THEME_STORAGE_KEY,
} from '../../src/theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  // Reset module-level state between tests by calling applyTheme('light').
  applyTheme('light');
});

describe('applyTheme', () => {
  it('sets data-theme attribute on <html>', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('persists to localStorage', () => {
    applyTheme('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    applyTheme('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('emits mmb:theme-change event with mode detail', () => {
    const received: string[] = [];
    document.addEventListener('mmb:theme-change', (e) => {
      received.push((e as CustomEvent<{ mode: string }>).detail.mode);
    });
    applyTheme('dark');
    applyTheme('light');
    expect(received).toEqual(['dark', 'light']);
  });

  it('switches getActivePalette to dark palette', () => {
    applyTheme('light');
    const lightHealthy = getActivePalette().healthy;
    applyTheme('dark');
    const darkHealthy = getActivePalette().healthy;
    expect(darkHealthy).not.toBe(lightHealthy);
  });

  it('getActiveMode reflects current theme', () => {
    applyTheme('dark');
    expect(getActiveMode()).toBe('dark');
    applyTheme('light');
    expect(getActiveMode()).toBe('light');
  });
});

describe('initTheme', () => {
  it('defaults to light when localStorage is empty', () => {
    localStorage.clear();
    initTheme();
    expect(getActiveMode()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('restores dark from localStorage', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    initTheme();
    expect(getActiveMode()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('treats unknown stored value as light', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    initTheme();
    expect(getActiveMode()).toBe('light');
  });
});
