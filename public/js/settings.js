/** User preferences: theme, hints — persisted per portal user. */

import { loadSettings as loadRaw, saveSettingsRaw } from './storage.js?v=6';

export const THEMES = {
  paper: { id: 'paper', label: 'Paper', blurb: 'Warm off-white (default)', group: 'light' },
  sky: { id: 'sky', label: 'Sky', blurb: 'Bright daylight blue', group: 'light' },
  sand: { id: 'sand', label: 'Sand', blurb: 'Cream and soft tan', group: 'light' },
  mint: { id: 'mint', label: 'Mint', blurb: 'Fresh light green', group: 'light' },
  lavender: { id: 'lavender', label: 'Lavender', blurb: 'Soft lilac wash', group: 'light' },
  coral: { id: 'coral', label: 'Coral', blurb: 'Peach and rose light', group: 'light' },
  slate: { id: 'slate', label: 'Slate', blurb: 'Cool medium gray', group: 'medium' },
  midnight: { id: 'midnight', label: 'Midnight', blurb: 'Deep navy dark', group: 'dark' },
  ocean: { id: 'ocean', label: 'Ocean', blurb: 'Dark teal night', group: 'dark' },
};

export const THEME_ORDER = [
  'paper', 'sky', 'sand', 'mint', 'lavender', 'coral', 'slate', 'midnight', 'ocean',
];

const DEFAULTS = { theme: 'paper', hints: false };

export function loadSettings(userId) {
  const parsed = loadRaw(userId);
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULTS };
  return {
    theme: THEMES[parsed.theme] ? parsed.theme : DEFAULTS.theme,
    hints: !!parsed.hints,
  };
}

export function saveSettings(userId, settings) {
  const next = {
    theme: THEMES[settings.theme] ? settings.theme : DEFAULTS.theme,
    hints: !!settings.hints,
  };
  saveSettingsRaw(userId, next);
  return next;
}

export function applyTheme(themeId) {
  const id = THEMES[themeId] ? themeId : DEFAULTS.theme;
  document.documentElement.setAttribute('data-theme', id);
  return id;
}
