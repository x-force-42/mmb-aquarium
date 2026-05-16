export type ThemeMode = 'light' | 'dark';

export type Palette = {
  healthy: number;
  decayed: number;
  freak: number;
  happy: number;
  defeated: number;
  spriteBase: number;
  spriteName: number;
};

export const THEME_STORAGE_KEY = 'mmb-theme';

const LIGHT: Palette = {
  healthy: 0x4a90e2,
  decayed: 0x8a8a8a,
  freak: 0xe74c3c,
  happy: 0xf5c542,
  defeated: 0x6e6e6e,
  spriteBase: 0xffffff,
  spriteName: 0x333333,
};

const DARK: Palette = {
  healthy: 0x6ba8ee,
  decayed: 0xa0a0a0,
  freak: 0xff6e57,
  happy: 0xffd96b,
  defeated: 0x888888,
  spriteBase: 0xe8e8e8,
  spriteName: 0xb8b8b8,
};

let _mode: ThemeMode = 'light';
let _palette: Palette = LIGHT;

export function getActivePalette(): Palette {
  return _palette;
}

export function getActiveMode(): ThemeMode {
  return _mode;
}

export function applyTheme(mode: ThemeMode): void {
  _mode = mode;
  _palette = mode === 'dark' ? DARK : LIGHT;
  document.documentElement.setAttribute('data-theme', mode);
  localStorage.setItem(THEME_STORAGE_KEY, mode);
  document.dispatchEvent(new CustomEvent('mmb:theme-change', { detail: { mode } }));
}

export function initTheme(): void {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  const mode: ThemeMode = stored === 'dark' ? 'dark' : 'light';
  applyTheme(mode);
}
