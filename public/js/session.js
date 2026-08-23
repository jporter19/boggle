/**
 * Game session: create, serialize, hydrate, resume policy.
 *
 * status: 'playing' | 'cleared'
 *   playing  — goals not yet met; resumable
 *   cleared  — goals met (may still keep finding); not resumable as unfinished
 * goalsMet mirrors status === 'cleared' once true.
 */

import { CELL_COUNT } from './grid.js?v=6';
import {
  normalizeGoals,
  goalProgress,
  detectMultiTileId,
} from './scoring.js?v=6';

export const SESSION_VERSION = 2;

/**
 * @param {object} board from pickPuzzle
 */
export function createSession(board) {
  const goals = normalizeGoals(board.goals);
  if (!goals) {
    throw new Error(`Board ${board.id} has invalid goals`);
  }
  return {
    version: SESSION_VERSION,
    id: board.id,
    level: board.level,
    grid: board.grid.slice(),
    goals,
    stats: board.stats ? { ...board.stats } : { total: 0 },
    multiTile: board.multiTile || detectMultiTileId(board.grid),
    found: [],
    foundSet: new Set(),
    wordPoints: 0,
    path: [],
    elapsedMs: 0,
    goalsMet: false,
    status: 'playing',
    longestWord: '',
    hintPenalty: 0,
    hintUsed: 0,
    hintTarget: null,
  };
}

/**
 * @param {object} session
 */
export function serializeSession(session) {
  if (!session) return null;
  return {
    version: SESSION_VERSION,
    id: session.id,
    level: session.level,
    grid: session.grid,
    goals: session.goals,
    stats: session.stats || { total: 0 },
    multiTile: session.multiTile || null,
    found: session.found.map((f) => ({
      word: f.word,
      score: f.score,
      usedMulti: !!f.usedMulti,
    })),
    wordPoints: session.wordPoints,
    elapsedMs: session.elapsedMs,
    goalsMet: !!session.goalsMet,
    status: session.status === 'cleared' ? 'cleared' : 'playing',
    longestWord: session.longestWord || '',
    hintPenalty: Math.max(0, Math.round(session.hintPenalty || 0)),
    hintUsed: Math.max(0, Math.round(session.hintUsed || 0)),
    hintTarget: serializeHintTarget(session.hintTarget),
  };
}

/**
 * @param {object|null} saved
 * @param {{ findBoardById?: (id: string) => object|null }} [opts]
 * @returns {object|null}
 */
export function restoreSession(saved, opts = {}) {
  if (!saved || typeof saved !== 'object') return null;
  if (!Array.isArray(saved.grid) || saved.grid.length !== CELL_COUNT) return null;
  if (!saved.id || !saved.level) return null;

  let goals = normalizeGoals(saved.goals);
  let stats = saved.stats && typeof saved.stats === 'object' ? { ...saved.stats } : null;
  let multiTile = saved.multiTile || null;
  let grid = saved.grid.slice();

  const fromBank = opts.findBoardById?.(saved.id) || null;
  if (fromBank) {
    if (!goals) goals = normalizeGoals(fromBank.goals);
    if (!stats?.total && fromBank.stats) stats = { ...fromBank.stats };
    if (!multiTile && fromBank.multiTile) multiTile = fromBank.multiTile;
    if (Array.isArray(fromBank.grid) && fromBank.grid.length === CELL_COUNT) {
      // Prefer saved grid (in-progress); only fill if missing
    }
  }
  if (!goals) return null;
  if (!stats) stats = { total: 0 };
  if (!multiTile) multiTile = detectMultiTileId(grid);

  const foundRaw = Array.isArray(saved.found) ? saved.found : [];
  const found = foundRaw
    .filter((f) => f && typeof f.word === 'string' && f.word.length >= 3)
    .map((f) => ({
      word: String(f.word).toLowerCase(),
      score: Number(f.score) || 0,
      usedMulti: !!f.usedMulti,
    }));
  const foundSet = new Set(found.map((f) => f.word));
  const wordPoints =
    typeof saved.wordPoints === 'number'
      ? saved.wordPoints
      : found.reduce((s, f) => s + (f.score || 0), 0);

  // Derive status: prefer explicit; migrate legacy completed
  let status = saved.status === 'cleared' ? 'cleared' : 'playing';
  if (saved.completed) status = 'cleared';
  let goalsMet = !!saved.goalsMet || status === 'cleared';
  if (!goalsMet) {
    const prog = goalProgress(found, goals, wordPoints);
    if (prog.complete) {
      goalsMet = true;
      status = 'cleared';
    }
  }
  if (goalsMet) status = 'cleared';

  return {
    version: SESSION_VERSION,
    id: saved.id,
    level: saved.level,
    grid,
    goals,
    stats,
    multiTile,
    found,
    foundSet,
    wordPoints,
    path: [],
    elapsedMs: Math.max(0, Number(saved.elapsedMs) || 0),
    goalsMet,
    status,
    longestWord: saved.longestWord || longestOf(found),
    hintPenalty: Math.max(0, Math.round(saved.hintPenalty || 0)),
    hintUsed: Math.max(0, Math.round(saved.hintUsed || 0)),
    hintTarget: normalizeHintTarget(saved.hintTarget, foundSet),
  };
}

/**
 * Unfinished session suitable for the resume banner.
 * @param {object|null} saved raw localStorage blob
 */
export function isResumableSave(saved) {
  if (!saved || typeof saved !== 'object') return false;
  if (saved.status === 'cleared' || saved.completed || saved.goalsMet) return false;
  if (!Array.isArray(saved.grid) || saved.grid.length !== CELL_COUNT) return false;
  if (!saved.id || !saved.level) return false;
  return true;
}

/**
 * @param {object} session
 */
export function markCleared(session) {
  session.goalsMet = true;
  session.status = 'cleared';
}

function longestOf(found) {
  let best = '';
  for (const f of found) {
    if ((f.word || '').length > best.length) best = f.word;
  }
  return best;
}

function serializeHintTarget(target) {
  if (!target || typeof target !== 'object') return null;
  if (!target.word || !Array.isArray(target.path) || !target.path.length) return null;
  return {
    word: String(target.word).toLowerCase(),
    path: target.path.slice(),
    revealCount: Math.max(0, target.revealCount | 0),
  };
}

/**
 * @param {object|null} raw
 * @param {Set<string>} foundSet
 */
function normalizeHintTarget(raw, foundSet) {
  if (!raw || typeof raw !== 'object') return null;
  const word = String(raw.word || '').toLowerCase();
  if (word.length < 3) return null;
  if (foundSet && foundSet.has(word)) return null;
  if (!Array.isArray(raw.path) || !raw.path.length) return null;
  const path = [];
  const seen = new Set();
  for (const n of raw.path) {
    const i = Number(n);
    if (!Number.isInteger(i) || i < 0 || i >= CELL_COUNT) return null;
    if (seen.has(i)) return null;
    seen.add(i);
    path.push(i);
  }
  return {
    word,
    path,
    revealCount: Math.max(0, Math.min(path.length, Number(raw.revealCount) || 0)),
  };
}
