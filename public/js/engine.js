/** Path building and word submission. */

import { isWord as dictIsWord } from './dictionary.js?v=6';
import { neighbors, isAdjacent, pathToWord } from './grid.js?v=6';
import { scorePath, goalProgress, isMultiTile } from './scoring.js?v=6';
import { markCleared } from './session.js?v=6';

export { neighbors, isAdjacent, pathToWord };

export function pathStart(session, index) {
  if (index < 0 || index > 15) return false;
  session.path = [index];
  return true;
}

export function pathExtend(session, index) {
  if (!session.path.length) return pathStart(session, index);
  if (session.path.includes(index)) {
    if (session.path.length >= 2 && session.path[session.path.length - 2] === index) {
      session.path.pop();
      return true;
    }
    return false;
  }
  const last = session.path[session.path.length - 1];
  if (!isAdjacent(last, index)) return false;
  session.path.push(index);
  return true;
}

export function pathClear(session) {
  if (session) session.path = [];
}

/**
 * @returns {{ ok: boolean, reason?: string, word?: string, score?: number, goalsComplete?: boolean }}
 */
export function submitPath(session) {
  const path = session.path.slice();
  pathClear(session);
  if (path.length < 1) return { ok: false, reason: 'empty' };

  const word = pathToWord(session.grid, path);
  if (word.length < 3) return { ok: false, reason: 'short', word };
  if (!dictIsWord(word)) return { ok: false, reason: 'invalid', word };
  if (session.foundSet.has(word)) return { ok: false, reason: 'duplicate', word };

  const score = scorePath(session.grid, path);
  const usedMulti = path.some((i) => isMultiTile(session.grid[i]));
  session.found.push({ word, score, path, usedMulti });
  session.foundSet.add(word);
  session.wordPoints += score;
  if (!session.longestWord || word.length > session.longestWord.length) {
    session.longestWord = word;
  }

  const progress = getGoalProgress(session);
  if (progress.complete && !session.goalsMet) {
    markCleared(session);
  }

  return {
    ok: true,
    word,
    score,
    goalsComplete: progress.complete,
  };
}

export function getGoalProgress(session) {
  return goalProgress(session.found, session.goals, session.wordPoints);
}

export function currentPathWord(session) {
  if (!session?.path?.length) return '';
  return pathToWord(session.grid, session.path);
}

export function currentPathScore(session) {
  if (!session?.path?.length) return 0;
  return scorePath(session.grid, session.path);
}
