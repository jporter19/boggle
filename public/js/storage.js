/** localStorage helpers scoped by portal user_id */

const PREFIX = 'porter-word-paths:v2:';
const LEGACY_PREFIXES = ['porter-word-paths:v1:'];

export function loadState(userId) {
  return loadJson(userId, 'state', null, true);
}

export function saveState(userId, state) {
  saveJson(userId, 'state', state);
}

export function clearState(userId) {
  removeKey(userId, 'state');
}

export function loadHistory(userId) {
  const list = loadJson(userId, 'history', [], true);
  return Array.isArray(list) ? list : [];
}

export function appendHistory(userId, entry, limit = 12) {
  const list = loadHistory(userId);
  list.unshift(entry);
  const trimmed = list.slice(0, limit);
  saveJson(userId, 'history', trimmed);
  return trimmed;
}

export function clearHistory(userId) {
  removeKey(userId, 'history');
}

export function loadRecentBoardIds(userId) {
  const list = loadJson(userId, 'recent', [], true);
  return Array.isArray(list) ? list : [];
}

export function rememberBoardId(userId, boardId, limit = 200) {
  const list = loadRecentBoardIds(userId).filter((id) => id !== boardId);
  list.unshift(boardId);
  saveJson(userId, 'recent', list.slice(0, limit));
}

export function loadBestScores(userId) {
  const obj = loadJson(userId, 'best', {}, true);
  return obj && typeof obj === 'object' ? obj : {};
}

export function saveBestScore(userId, levelId, score) {
  const best = loadBestScores(userId);
  if (score > (best[levelId] || 0)) {
    best[levelId] = score;
    saveJson(userId, 'best', best);
  }
  return best;
}

export function loadSettings(userId) {
  return loadJson(userId, 'settings', null, true);
}

export function saveSettingsRaw(userId, settings) {
  saveJson(userId, 'settings', settings);
}

function loadJson(userId, suffix, fallback, migrateLegacy = false) {
  try {
    let raw = localStorage.getItem(key(userId, suffix));
    if (!raw && migrateLegacy) {
      for (const leg of LEGACY_PREFIXES) {
        raw = localStorage.getItem(`${leg}${userId || 'anon'}:${suffix}`);
        if (raw) {
          try {
            localStorage.setItem(key(userId, suffix), raw);
            localStorage.removeItem(`${leg}${userId || 'anon'}:${suffix}`);
          } catch {
            /* ignore */
          }
          break;
        }
      }
    }
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveJson(userId, suffix, value) {
  try {
    localStorage.setItem(key(userId, suffix), JSON.stringify(value));
  } catch {
    /* quota */
  }
}

function removeKey(userId, suffix) {
  try {
    localStorage.removeItem(key(userId, suffix));
    for (const leg of LEGACY_PREFIXES) {
      localStorage.removeItem(`${leg}${userId || 'anon'}:${suffix}`);
    }
  } catch {
    /* ignore */
  }
}

function key(userId, suffix) {
  return `${PREFIX}${userId || 'anon'}:${suffix}`;
}
