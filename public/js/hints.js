/** Path-aware hints: pick an unfound word, escalate tile reveal, apply score cost. */

import { isWord, hasPrefix } from './dictionary.js?v=6';
import { neighbors, CELL_COUNT } from './grid.js?v=6';
import {
  tileLetters,
  scorePath,
  isMultiTile,
  goalProgress,
} from './scoring.js?v=6';

export const HINT_PENALTY = 15;
export const HINT_INITIAL_TILES = 2;
export const HINT_CYCLES = 2;
export const HINT_FLASH_MS = 500;
export const HINT_GAP_MS = 80;
export const HINT_CYCLE_GAP_MS = 250;
export const HINT_REDUCED_MOTION_MS = 800;

export function hintPenaltyAmount() {
  return HINT_PENALTY;
}

/**
 * @param {number} prev
 * @param {number} pathLen
 */
export function nextRevealCount(prev, pathLen) {
  const len = Math.max(0, pathLen | 0);
  if (!len) return 0;
  const prior = Math.max(0, prev | 0);
  if (prior < HINT_INITIAL_TILES) return Math.min(HINT_INITIAL_TILES, len);
  return Math.min(len, prior + 1);
}

/**
 * @param {number[]} path
 * @param {number} revealCount
 * @returns {number[]}
 */
export function buildHintPlayback(path, revealCount) {
  if (!Array.isArray(path) || !path.length) return [];
  const n = Math.max(0, revealCount | 0);
  return path.slice(0, n);
}

/**
 * @param {object} session
 */
export function applyHintCharge(session) {
  session.hintUsed = (session.hintUsed || 0) + 1;
  session.hintPenalty = (session.hintPenalty || 0) + HINT_PENALTY;
}

/**
 * One path per unfound dictionary word on the grid.
 * @param {string[]} grid
 * @param {Set<string>|string[]} foundSet
 * @returns {Array<{ word: string, path: number[], score: number, usedMulti: boolean }>}
 */
export function findUnfoundWords(grid, foundSet) {
  const found =
    foundSet instanceof Set ? foundSet : new Set(foundSet || []);
  /** @type {Map<string, { word: string, path: number[], score: number, usedMulti: boolean }>} */
  const results = new Map();
  const letters = (grid || []).map((t) => tileLetters(t));
  if (letters.length !== CELL_COUNT) return [];

  function dfs(idx, mask, word, path, usedMulti) {
    if (word.length >= 3 && isWord(word) && !found.has(word) && !results.has(word)) {
      results.set(word, {
        word,
        path: path.slice(),
        score: scorePath(grid, path),
        usedMulti,
      });
    }
    if (word.length >= 12) return;
    for (const j of neighbors(idx)) {
      if (mask & (1 << j)) continue;
      const next = word + letters[j];
      if (!hasPrefix(next)) continue;
      path.push(j);
      dfs(j, mask | (1 << j), next, path, usedMulti || isMultiTile(grid[j]));
      path.pop();
    }
  }

  for (let i = 0; i < CELL_COUNT; i++) {
    const start = letters[i];
    if (!hasPrefix(start)) continue;
    dfs(i, 1 << i, start, [i], isMultiTile(grid[i]));
  }
  return [...results.values()];
}

/** First unfinished goal wins: word total, then length, special tile, points. */
const HINT_GOAL_ORDER = ['words', 'wordLen', 'multi', 'points'];

function helpsGoal(c, goalId, session) {
  if (goalId === 'words') return true;
  if (goalId === 'points') return (c.score || 0) > 0;
  if (goalId === 'multi') return !!c.usedMulti;
  if (goalId === 'wordLen') {
    const wl = session.goals?.wordLen;
    if (!wl || wl.len < 3) return false;
    const nlen = c.word.length;
    const L = wl.len | 0;
    return wl.mode === 'exact' ? nlen === L : nlen >= L;
  }
  return false;
}

function easiestFirst(a, b) {
  if (a.word.length !== b.word.length) return a.word.length - b.word.length;
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  if (a.score !== b.score) return a.score - b.score;
  return a.word.localeCompare(b.word);
}

/**
 * Remaining word that advances the first unfinished goal, easiest first.
 * @param {object} session
 * @param {string} [previousWord]
 * @returns {{ word: string, path: number[], score: number, usedMulti: boolean }|null}
 */
export function pickHintTarget(session, previousWord = '') {
  if (!session?.grid) return null;
  const foundSet =
    session.foundSet || new Set((session.found || []).map((f) => f.word));
  const exclude = String(previousWord || '').toLowerCase();
  const all = findUnfoundWords(session.grid, foundSet).filter(
    (c) => c.word !== exclude && c.path.length > 0,
  );
  if (!all.length) return null;

  const progress = goalProgress(session.found, session.goals, session.wordPoints);
  const unfinished = new Set(
    (progress.items || []).filter((it) => !it.done).map((it) => it.id),
  );

  for (const goalId of HINT_GOAL_ORDER) {
    if (!unfinished.has(goalId)) continue;
    const pool = all.filter((c) => helpsGoal(c, goalId, session));
    if (pool.length) {
      pool.sort(easiestFirst);
      return pool[0];
    }
  }

  all.sort(easiestFirst);
  return all[0];
}

/**
 * Lock / escalate the session hint target. Mutates session.
 * @param {object} session
 * @returns {{ path: number[], revealCount: number, charged: boolean, empty?: boolean }}
 */
export function advanceHint(session) {
  const foundSet = session.foundSet || new Set();
  let target = session.hintTarget;
  if (!target || foundSet.has(target.word) || !target.path?.length) {
    target = null;
  }

  if (!target) {
    const nxt = pickHintTarget(session, session.hintTarget?.word);
    if (!nxt) {
      return { path: [], revealCount: 0, charged: false, empty: true };
    }
    target = { word: nxt.word, path: nxt.path.slice(), revealCount: 0 };
  }

  target.revealCount = nextRevealCount(target.revealCount, target.path.length);
  session.hintTarget = target;
  applyHintCharge(session);
  return {
    path: target.path,
    revealCount: target.revealCount,
    charged: true,
  };
}
