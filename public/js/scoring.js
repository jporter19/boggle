/** Levels, tile values (from rules.json), goals, score formula. */

/** @type {object|null} */
let rules = null;
/** @type {Record<string, { id: string, letters: string, value: number, label: string }>} */
let multiByKey = {};
/** @type {Record<string, number>} */
let letterValues = {};
/** @type {Record<number, number>} */
let lengthMult = {};
let minWordLen = 3;

export const LEVELS = {
  easy: {
    id: 'easy',
    label: 'Easy',
    blurb: 'Open letters, gentler targets',
    avgTimeSec: 6 * 60,
    baseScore: 1000,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    blurb: 'Balanced board, longer words',
    avgTimeSec: 10 * 60,
    baseScore: 2500,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    blurb: 'Tougher mix, stricter goals',
    avgTimeSec: 15 * 60,
    baseScore: 6000,
  },
  expert: {
    id: 'expert',
    label: 'Expert',
    blurb: 'Sparse paths, high targets',
    avgTimeSec: 22 * 60,
    baseScore: 15000,
  },
};

export const LEVEL_ORDER = ['easy', 'medium', 'hard', 'expert'];

/**
 * Load shared scoring rules (must run before play).
 * @returns {Promise<object>}
 */
export async function loadRules() {
  if (rules) return rules;
  const res = await fetch('data/rules.json', { cache: 'force-cache' });
  if (!res.ok) throw new Error(`rules ${res.status}`);
  const data = await res.json();
  applyRules(data);
  return rules;
}

/**
 * @param {object} data
 */
export function applyRules(data) {
  rules = data;
  letterValues = { ...(data.letterValues || {}) };
  lengthMult = {};
  const lm = data.lengthMult || {};
  for (const [k, v] of Object.entries(lm)) {
    lengthMult[Number(k)] = Number(v);
  }
  minWordLen = data.minWordLen || 3;
  multiByKey = {};
  for (const m of data.multiTiles || []) {
    const id = String(m.id);
    const entry = {
      id,
      letters: String(m.letters).toLowerCase(),
      value: Number(m.value) || 0,
      label: String(m.label || id),
    };
    multiByKey[id.toLowerCase()] = entry;
    multiByKey[entry.letters] = entry;
  }
}

export function rulesLoaded() {
  return !!rules;
}

/**
 * Normalize grid token to multi-tile key or single lowercase letter.
 * @param {string} tile
 */
export function normalizeTile(tile) {
  const low = String(tile || '').trim().toLowerCase();
  if (multiByKey[low]) return multiByKey[low].id.toLowerCase();
  return low;
}

/**
 * @param {string} tile
 */
export function tileLetters(tile) {
  const low = String(tile || '').trim().toLowerCase();
  const m = multiByKey[low];
  if (m) return m.letters;
  return low;
}

/**
 * @param {string} tile
 */
export function tileValue(tile) {
  const low = String(tile || '').trim().toLowerCase();
  const m = multiByKey[low];
  if (m) return m.value;
  return letterValues[low] || 0;
}

/**
 * @param {string} tile
 */
export function tileLabel(tile) {
  const low = String(tile || '').trim().toLowerCase();
  const m = multiByKey[low];
  if (m) return m.label;
  return low.toUpperCase();
}

/**
 * @param {string} tile
 */
export function isMultiTile(tile) {
  const low = String(tile || '').trim().toLowerCase();
  return !!multiByKey[low];
}

/**
 * Multi-tile id on grid if any (e.g. "Qu"), else null.
 * @param {string[]} grid
 */
export function detectMultiTileId(grid) {
  for (const t of grid || []) {
    const low = String(t).trim().toLowerCase();
    const m = multiByKey[low];
    if (m) return m.id;
  }
  return null;
}

/**
 * Score a path (sum of tile values × length multiplier of expanded word).
 * @param {string[]} grid
 * @param {number[]} path
 */
export function scorePath(grid, path) {
  if (!path?.length) return 0;
  let base = 0;
  let word = '';
  for (const i of path) {
    base += tileValue(grid[i]);
    word += tileLetters(grid[i]);
  }
  if (word.length < minWordLen) return 0;
  const mult = lengthMult[word.length] ?? Math.max(7, word.length - 3);
  return Math.round(base * mult);
}

/**
 * Validate board goals (current contract only).
 * @param {object} goals
 * @returns {object|null} normalized goals or null
 */
export function normalizeGoals(goals) {
  if (!goals || typeof goals !== 'object') return null;
  const points = Number(goals.points);
  const wl = goals.wordLen;
  if (!Number.isFinite(points) || points < 1) return null;
  if (!wl || typeof wl !== 'object') return null;
  const len = Number(wl.len);
  const count = Number(wl.count);
  if (!Number.isFinite(len) || len < 3 || len > 10) return null;
  if (!Number.isFinite(count) || count < 1) return null;
  const mode = wl.mode === 'exact' ? 'exact' : 'min';
  /** @type {object} */
  const out = {
    points: Math.round(points),
    wordLen: { len: len | 0, count: count | 0, mode },
  };
  if (goals.words != null && Number(goals.words) > 0) {
    out.words = Math.round(Number(goals.words));
  }
  if (goals.multiWords != null && Number(goals.multiWords) > 0) {
    out.multiWords = Math.round(Number(goals.multiWords));
    if (goals.multiLabel) out.multiLabel = String(goals.multiLabel);
  }
  return out;
}

/**
 * @param {Array<{ word: string, score: number, usedMulti?: boolean }>} found
 * @param {object} goals
 * @param {number} wordPoints
 */
export function goalProgress(found, goals, wordPoints = 0) {
  const list = Array.isArray(found) ? found : [];
  const g = normalizeGoals(goals) || goals || {};
  const items = [];

  if (g.points > 0) {
    const cur = Math.max(0, Math.round(wordPoints || 0));
    items.push({
      id: 'points',
      label: 'Points',
      current: cur,
      target: g.points,
      done: cur >= g.points,
    });
  }

  if (g.words > 0) {
    items.push({
      id: 'words',
      label: 'Words',
      current: list.length,
      target: g.words,
      done: list.length >= g.words,
    });
  }

  if (g.wordLen && g.wordLen.len >= 3) {
    const L = g.wordLen.len | 0;
    const need = g.wordLen.count | 0;
    const mode = g.wordLen.mode === 'exact' ? 'exact' : 'min';
    const cur = list.filter((f) => {
      const n = (f.word || '').length;
      return mode === 'exact' ? n === L : n >= L;
    }).length;
    items.push({
      id: 'wordLen',
      label: mode === 'exact' ? `${L}-letter words` : `${L}+ letter words`,
      current: cur,
      target: need,
      done: cur >= need,
    });
  }

  if (g.multiWords > 0) {
    const cur = list.filter((f) => f.usedMulti).length;
    const piece = g.multiLabel ? String(g.multiLabel) : 'special tile';
    items.push({
      id: 'multi',
      label: `Uses ${piece}`,
      current: cur,
      target: g.multiWords,
      done: cur >= g.multiWords,
    });
  }

  const complete = items.length > 0 && items.every((it) => it.done);
  return { items, complete };
}

/**
 * Displayed / final word points after hint deductions. Goals still use raw wordPoints.
 * @param {number} wordPoints
 * @param {number} hintPenalty
 */
export function liveScore(wordPoints, hintPenalty = 0) {
  const wp = Math.max(0, Math.round(wordPoints || 0));
  const pen = Math.max(0, Math.round(hintPenalty || 0));
  return Math.max(0, wp - pen);
}

/**
 * Final score after clearing goals.
 * @param {string} levelId
 * @param {number} wordPoints raw word points (before hint penalty)
 * @param {number} elapsedSec
 * @param {number} [hintPenalty]
 */
export function computeFinalScore(levelId, wordPoints, elapsedSec, hintPenalty = 0) {
  const penalty = Math.max(0, Math.round(hintPenalty || 0));
  const raw = Math.max(0, Math.round(wordPoints || 0));
  const wp = liveScore(raw, penalty);
  const level = LEVELS[levelId];
  if (!level) {
    return {
      score: wp,
      wordPoints: wp,
      wordPointsRaw: raw,
      hintPenalty: penalty,
      multiplier: 1,
      baseScore: 0,
      elapsedSec: 0,
      avgTimeSec: 0,
    };
  }
  const t = Math.max(1, Math.floor(elapsedSec || 0));
  const ratio = level.avgTimeSec / t;
  const multiplier = Math.min(1.5, Math.max(0.5, ratio));
  const blended = wp + Math.round(level.baseScore * 0.15);
  const score = Math.max(1, Math.round(blended * multiplier));
  return {
    score,
    wordPoints: wp,
    wordPointsRaw: raw,
    hintPenalty: penalty,
    multiplier,
    baseScore: level.baseScore,
    elapsedSec: t,
    avgTimeSec: level.avgTimeSec,
    faster: t < level.avgTimeSec,
  };
}

export function formatTime(totalSec) {
  const s = Math.max(0, Math.floor(totalSec || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function formatScore(n) {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0));
}

export function scoreBreakdownText(result) {
  const pct = Math.round((result.multiplier || 1) * 100);
  const vs = result.faster ? 'faster than' : 'slower than';
  const raw = result.wordPointsRaw != null ? result.wordPointsRaw : result.wordPoints;
  const pen = result.hintPenalty || 0;
  const wordsBit = pen
    ? `${formatScore(raw)} from words − ${formatScore(pen)} hints`
    : `${formatScore(result.wordPoints)} from words`;
  return `${wordsBit} + level bonus × ${pct}% (${vs} avg ${formatTime(result.avgTimeSec)})`;
}
