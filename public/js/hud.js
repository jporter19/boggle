/** Play HUD: goals, found list, path preview. */

import { isWord } from './dictionary.js?v=6';
import {
  currentPathWord,
  currentPathScore,
  getGoalProgress,
} from './engine.js?v=6';
import { formatScore, formatTime, liveScore } from './scoring.js?v=6';

/**
 * @param {object} ui element map
 * @param {object} session
 * @param {{ paintPath?: () => void }|null} boardCtl
 */
export function paintHud(ui, session) {
  if (!session) return;
  ui.liveScore.textContent = formatScore(
    liveScore(session.wordPoints, session.hintPenalty),
  );
  ui.foundCount.textContent = String(session.found.length);
  ui.clock.textContent = formatTime(session.elapsedMs / 1000);

  const total = session.stats?.total || 0;
  if (ui.totalWords) {
    ui.totalWords.textContent = total ? String(total) : '—';
  }
  ui.foundTotal.textContent = total
    ? `${session.found.length} found · ${total} in puzzle`
    : `(${session.found.length})`;

  const progress = getGoalProgress(session);
  ui.goalsList.innerHTML = progress.items
    .map(
      (it) => `<li class="goal-item ${it.done ? 'is-done' : ''}">
        <span class="goal-check" aria-hidden="true">${it.done ? '✓' : '○'}</span>
        <span class="goal-label">${escapeHtml(it.label)}</span>
        <span class="goal-count mono">${formatGoalCount(it)}</span>
      </li>`,
    )
    .join('');

  if (total) {
    ui.goalsList.insertAdjacentHTML(
      'beforeend',
      `<li class="goal-item goal-inventory muted">
        <span class="goal-check" aria-hidden="true">ℹ</span>
        <span class="goal-label">Words in this puzzle</span>
        <span class="goal-count mono">${total}</span>
      </li>`,
    );
  }

  const sorted = [...session.found].sort(
    (a, b) => b.word.length - a.word.length || a.word.localeCompare(b.word),
  );
  ui.foundList.innerHTML = sorted
    .map(
      (f) => `<li>
        <span class="found-word">${escapeHtml(f.word.toUpperCase())}${f.usedMulti ? ' ★' : ''}</span>
        <span class="mono muted">${f.score}</span>
      </li>`,
    )
    .join('');
}

/**
 * @param {object} ui
 * @param {object} session
 * @param {{ paintPath?: () => void }|null} boardCtl
 */
export function updatePathPreview(ui, session, boardCtl) {
  if (!session) return;
  const word = currentPathWord(session);
  const pathScore = currentPathScore(session);
  ui.pathWord.textContent = word ? word.toUpperCase() : '';
  if (!word) {
    ui.pathHint.textContent = 'Drag letters to form a word';
    ui.pathWord.className = 'path-word';
  } else if (word.length < 3) {
    ui.pathHint.textContent = 'Need at least 3 letters';
    ui.pathWord.className = 'path-word is-short';
  } else if (session.foundSet.has(word)) {
    ui.pathHint.textContent = 'Already found';
    ui.pathWord.className = 'path-word is-dup';
  } else if (isWord(word)) {
    ui.pathHint.textContent = pathScore ? `Release · ${pathScore} pts` : 'Release to submit';
    ui.pathWord.className = 'path-word is-valid';
  } else {
    ui.pathHint.textContent = 'Not in dictionary';
    ui.pathWord.className = 'path-word is-invalid';
  }
  boardCtl?.paintPath?.();
}

function formatGoalCount(it) {
  if (it.id === 'points') {
    return `${formatScore(it.current)} / ${formatScore(it.target)}`;
  }
  return `${it.current} / ${it.target}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
