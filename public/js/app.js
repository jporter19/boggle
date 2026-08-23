/**
 * Word Paths — Porter Family Portal (shell / wiring only)
 */

import { ASSET_V } from './version.js?v=6';
import { resolveUser, redirectToLogin, displayName } from './auth.js?v=6';
import { mountBoard } from './board.js?v=6';
import { loadDictionary } from './dictionary.js?v=6';
import {
  pathStart,
  pathExtend,
  pathClear,
  submitPath,
} from './engine.js?v=6';
import {
  advanceHint,
  buildHintPlayback,
  hintPenaltyAmount,
  HINT_FLASH_MS,
  HINT_GAP_MS,
  HINT_CYCLE_GAP_MS,
  HINT_CYCLES,
  HINT_REDUCED_MOTION_MS,
} from './hints.js?v=6';
import { paintHud, updatePathPreview } from './hud.js?v=6';
import { loadBank, pickPuzzle, findBoardById } from './puzzles.js?v=6';
import {
  LEVELS,
  LEVEL_ORDER,
  loadRules,
  computeFinalScore,
  formatTime,
  formatScore,
  scoreBreakdownText,
  liveScore,
} from './scoring.js?v=6';
import {
  createSession,
  serializeSession,
  restoreSession,
  isResumableSave,
  markCleared,
} from './session.js?v=6';
import {
  loadSettings,
  saveSettings,
  applyTheme,
  THEMES,
  THEME_ORDER,
} from './settings.js?v=6';
import {
  loadState,
  saveState,
  clearState,
  loadHistory,
  appendHistory,
  clearHistory,
  loadRecentBoardIds,
  rememberBoardId,
  loadBestScores,
  saveBestScore,
} from './storage.js?v=6';

const $ = (id) => document.getElementById(id);

const ui = {
  loading: $('screen-loading'),
  denied: $('screen-denied'),
  menu: $('screen-menu'),
  play: $('screen-play'),
  menuPlayer: $('menu-player'),
  playPlayer: $('play-player'),
  levelGrid: $('level-grid'),
  resumeBanner: $('resume-banner'),
  resumeMeta: $('resume-meta'),
  historySection: $('history-section'),
  historyList: $('history-list'),
  board: $('board'),
  pathWord: $('path-word'),
  pathHint: $('path-hint'),
  goalsList: $('goals-list'),
  foundList: $('found-list'),
  foundTotal: $('found-total'),
  foundCount: $('found-count'),
  totalWords: $('total-words'),
  clock: $('clock'),
  liveScore: $('live-score'),
  playLevel: $('play-level'),
  btnToMenu: $('btn-to-menu'),
  btnResume: $('btn-resume'),
  btnDiscard: $('btn-discard'),
  btnNew: $('btn-new'),
  btnHint: $('btn-hint'),
  winModal: $('win-modal'),
  winTime: $('win-time'),
  winWords: $('win-words'),
  winScore: $('win-score'),
  winBreakdown: $('win-breakdown'),
  winLongest: $('win-longest'),
  winHints: $('win-hints'),
  btnWinContinue: $('btn-win-continue'),
  btnWinAgain: $('btn-win-again'),
  btnWinMenu: $('btn-win-menu'),
  settingsModal: $('settings-modal'),
  themeGrid: $('theme-grid'),
  settingHints: $('setting-hints'),
  btnResetScores: $('btn-reset-scores'),
  settingsStatus: $('settings-status'),
};

/** @type {object|null} */
let user = null;
/** @type {object|null} */
let bank = null;
/** @type {ReturnType<typeof createSession>|null} */
let session = null;
/** @type {ReturnType<typeof mountBoard>|null} */
let boardCtl = null;
/** @type {{ theme: string, hints: boolean }} */
let settings = { theme: 'paper', hints: false };
let hintPlaying = false;

let clockTimer = null;
let persistTimer = null;
let lastTick = 0;
/** Win modal shown once per clear in this play mount */
let winModalShown = false;

const THEME_SWATCH = {
  paper: ['#f4f1ea', '#2563eb', '#1c2430'],
  sky: ['#e8f3fc', '#0284c7', '#0f2740'],
  sand: ['#f7efe3', '#c2410c', '#3b2a1a'],
  mint: ['#e8f6ef', '#059669', '#143528'],
  lavender: ['#f0eaf8', '#7c3aed', '#2a1f3d'],
  coral: ['#fff0ec', '#e11d48', '#3f1f1a'],
  slate: ['#e4e8ee', '#0f766e', '#1e293b'],
  midnight: ['#0f1419', '#3d8bfd', '#8ec5ff'],
  ocean: ['#0a1620', '#2ec4b6', '#7fdbda'],
};

async function main() {
  void ASSET_V;
  const auth = await resolveUser();
  if (!auth.user && !auth.denied) {
    redirectToLogin();
    return;
  }
  if (auth.denied) {
    showScreen('denied');
    return;
  }
  user = auth.user;

  settings = loadSettings(user.user_id);
  applyTheme(settings.theme);
  syncThemeColorMeta();

  try {
    ui.loading.querySelector('p').textContent = 'Loading rules…';
    await loadRules();
    ui.loading.querySelector('p').textContent = 'Loading dictionary…';
    await loadDictionary();
    ui.loading.querySelector('p').textContent = 'Loading boards…';
    bank = await loadBank();
  } catch (err) {
    console.error(err);
    ui.loading.innerHTML = `<p class="error">Could not load game data. ${escapeHtml(String(err.message || err))}</p>`;
    return;
  }

  const name = displayName(user);
  ui.menuPlayer.innerHTML = `<strong>${escapeHtml(name)}</strong>`;
  ui.playPlayer.innerHTML = `<strong>${escapeHtml(name)}</strong>`;

  buildLevelCards();
  buildThemeGrid();
  bindGlobal();
  refreshMenuExtras();
  showScreen('menu');
}

function showScreen(name) {
  ui.loading.hidden = name !== 'loading';
  ui.denied.hidden = name !== 'denied';
  ui.menu.hidden = name !== 'menu';
  ui.play.hidden = name !== 'play';
  document.body.classList.toggle('is-playing', name === 'play');
}

function buildLevelCards() {
  ui.levelGrid.innerHTML = '';
  const best = loadBestScores(user.user_id);
  for (const id of LEVEL_ORDER) {
    const L = LEVELS[id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'level-card';
    btn.role = 'listitem';
    btn.dataset.level = id;
    const bestPts = best[id];
    btn.innerHTML = `
      <h3>${escapeHtml(L.label)}</h3>
      <div class="level-meta"><span>${escapeHtml(L.blurb)}</span></div>
      <div class="level-points">${
        bestPts
          ? `Best ${formatScore(bestPts)}`
          : `~${formatScore(L.baseScore)} pts at average pace`
      }</div>
    `;
    btn.addEventListener('click', () => startNewGame(id));
    ui.levelGrid.appendChild(btn);
  }
}

function buildThemeGrid() {
  ui.themeGrid.innerHTML = '';
  for (const id of THEME_ORDER) {
    const t = THEMES[id];
    const sw = THEME_SWATCH[id] || ['#888', '#666', '#444'];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-option';
    btn.role = 'option';
    btn.dataset.theme = id;
    btn.setAttribute('aria-selected', id === settings.theme ? 'true' : 'false');
    btn.innerHTML = `
      <strong>${escapeHtml(t.label)}</strong>
      <span class="theme-blurb">${escapeHtml(t.blurb)}</span>
      <span class="theme-swatches" aria-hidden="true">
        <i style="background:${sw[0]}"></i>
        <i style="background:${sw[1]}"></i>
        <i style="background:${sw[2]}"></i>
      </span>
    `;
    btn.addEventListener('click', () => selectTheme(id));
    ui.themeGrid.appendChild(btn);
  }
}

function selectTheme(themeId) {
  settings = saveSettings(user.user_id, { ...settings, theme: themeId });
  applyTheme(settings.theme);
  syncThemeColorMeta();
  for (const el of ui.themeGrid.querySelectorAll('.theme-option')) {
    el.setAttribute('aria-selected', el.dataset.theme === settings.theme ? 'true' : 'false');
  }
}

function syncThemeColorMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const cs = getComputedStyle(document.documentElement);
  meta.setAttribute('content', cs.getPropertyValue('--theme-color').trim() || '#f4f1ea');
}

function openSettings() {
  ui.settingHints.checked = !!settings.hints;
  for (const el of ui.themeGrid.querySelectorAll('.theme-option')) {
    el.setAttribute('aria-selected', el.dataset.theme === settings.theme ? 'true' : 'false');
  }
  ui.settingsStatus.hidden = true;
  ui.settingsStatus.textContent = '';
  ui.settingsModal.hidden = false;
  ui.settingsModal.classList.add('is-open');
  document.body.classList.add('modal-open');
}

function closeSettings() {
  ui.settingsModal.classList.remove('is-open');
  ui.settingsModal.hidden = true;
  document.body.classList.remove('modal-open');
  if (session && !ui.play.hidden) ui.btnHint.hidden = !settings.hints;
}

function refreshMenuExtras() {
  const saved = loadState(user.user_id);
  if (isResumableSave(saved)) {
    const L = LEVELS[saved.level];
    const words = Array.isArray(saved.found) ? saved.found.length : 0;
    const pts = formatScore(liveScore(saved.wordPoints, saved.hintPenalty));
    ui.resumeBanner.hidden = false;
    ui.resumeMeta.textContent = `${L?.label || saved.level} · ${formatTime((saved.elapsedMs || 0) / 1000)} · ${words} words · ${pts} pts`;
  } else {
    ui.resumeBanner.hidden = true;
    if (saved && !isResumableSave(saved)) {
      // Drop cleared / invalid snapshots so they cannot flicker back
      clearState(user.user_id);
    }
  }

  const history = loadHistory(user.user_id);
  if (!history.length) {
    ui.historySection.hidden = true;
    return;
  }
  ui.historySection.hidden = false;
  ui.historyList.innerHTML = history
    .map((h) => {
      const label = LEVELS[h.level]?.label || h.level;
      return `<li>
        <span>${escapeHtml(label)} · ${h.words || 0} words</span>
        <span class="mono muted">${formatTime(h.elapsedSec)}</span>
        <span class="mono">${formatScore(h.score)}</span>
      </li>`;
    })
    .join('');
}

function startNewGame(levelId) {
  const recent = loadRecentBoardIds(user.user_id);
  const picked = pickPuzzle(bank, levelId, recent);
  rememberBoardId(user.user_id, picked.id);
  session = createSession(picked);
  winModalShown = false;
  stopHintPlayback();
  enterPlay();
}

function resumeGame() {
  const saved = loadState(user.user_id);
  if (!isResumableSave(saved)) {
    ui.resumeBanner.hidden = true;
    alert('No unfinished game to resume.');
    return;
  }
  const g = restoreSession(saved, {
    findBoardById: (id) => findBoardById(bank, id),
  });
  if (!g || g.status !== 'playing') {
    clearState(user.user_id);
    refreshMenuExtras();
    alert('Could not restore the saved game.');
    return;
  }
  session = g;
  winModalShown = false;
  stopHintPlayback();
  enterPlay();
}

function enterPlay() {
  stopClockLoop();
  stopHintPlayback();
  showScreen('play');
  ui.playLevel.textContent = LEVELS[session.level]?.label || session.level;
  ui.btnHint.hidden = !settings.hints;
  ui.btnHint.disabled = false;
  ui.btnHint.title = `Hint (−${hintPenaltyAmount()})`;
  if (boardCtl) boardCtl.destroy();
  boardCtl = mountBoard(ui.board, session.grid, {
    onStart(i) {
      stopHintPlayback();
      pathStart(session, i);
      updatePathPreview(ui, session, boardCtl);
    },
    onExtend(i) {
      pathExtend(session, i);
      updatePathPreview(ui, session, boardCtl);
    },
    onEnd() {
      onPathSubmit();
    },
    getPath: () => session?.path || [],
  });
  paintHud(ui, session);
  startClockLoop();
  persist();
}

function onPathSubmit() {
  if (!session?.path?.length) {
    updatePathPreview(ui, session, boardCtl);
    return;
  }
  const result = submitPath(session);
  if (result.ok) {
    if (session.hintTarget && result.word === session.hintTarget.word) {
      session.hintTarget = null;
    }
    boardCtl?.setFlash('ok');
    paintHud(ui, session);
    persist();
    if (result.goalsComplete && !winModalShown) showWin();
  } else if (result.reason === 'duplicate') {
    boardCtl?.setFlash('dup');
  } else if (result.reason === 'invalid' || result.reason === 'short') {
    boardCtl?.setFlash('bad');
  }
  updatePathPreview(ui, session, boardCtl);
}

function startClockLoop() {
  stopClockLoop();
  lastTick = performance.now();
  clockTimer = window.setInterval(() => {
    if (!session || document.hidden) {
      lastTick = performance.now();
      return;
    }
    const now = performance.now();
    session.elapsedMs += now - lastTick;
    lastTick = now;
    ui.clock.textContent = formatTime(session.elapsedMs / 1000);
  }, 250);
  persistTimer = window.setInterval(() => persist(), 4000);
}

function stopClockLoop() {
  if (clockTimer) clearInterval(clockTimer);
  if (persistTimer) clearInterval(persistTimer);
  clockTimer = null;
  persistTimer = null;
}

function persist() {
  if (!session || !user) return;
  saveState(user.user_id, serializeSession(session));
}

function stopHintPlayback() {
  hintPlaying = false;
  if (ui.btnHint) ui.btnHint.disabled = false;
  boardCtl?.clearHintFlash?.();
}

function playBoardHint(path, revealCount, charged) {
  if (!boardCtl) return;
  const indices = buildHintPlayback(path, revealCount);
  if (!indices.length) return;
  hintPlaying = true;
  ui.btnHint.disabled = true;
  ui.pathHint.textContent = charged
    ? `Watch the board · −${hintPenaltyAmount()}`
    : 'Watch the board';
  boardCtl.playHintFlash(indices, {
    onMs: HINT_FLASH_MS,
    gapMs: HINT_GAP_MS,
    cycleGapMs: HINT_CYCLE_GAP_MS,
    cycles: HINT_CYCLES,
    reducedMs: HINT_REDUCED_MOTION_MS,
    onDone() {
      hintPlaying = false;
      ui.btnHint.disabled = false;
      if (session) updatePathPreview(ui, session, boardCtl);
    },
  });
  // Re-assert after playHintFlash: starting a flash aborts any leftover
  // sequence and would otherwise fire the previous onDone.
  hintPlaying = true;
  ui.btnHint.disabled = true;
}

function showWin() {
  if (!session || winModalShown) return;
  winModalShown = true;
  markCleared(session);
  const elapsedSec = session.elapsedMs / 1000;
  const result = computeFinalScore(
    session.level,
    session.wordPoints,
    elapsedSec,
    session.hintPenalty || 0,
  );
  saveBestScore(user.user_id, session.level, result.score);
  appendHistory(user.user_id, {
    level: session.level,
    score: result.score,
    words: session.found.length,
    elapsedSec: Math.floor(elapsedSec),
    longest: session.longestWord,
    at: Date.now(),
  });
  persist();

  ui.winTime.textContent = formatTime(elapsedSec);
  ui.winWords.textContent = String(session.found.length);
  ui.winScore.textContent = formatScore(result.score);
  ui.winBreakdown.textContent = scoreBreakdownText(result);
  ui.winLongest.textContent = session.longestWord
    ? `Longest word: ${session.longestWord.toUpperCase()}`
    : '';
  if (ui.winHints) {
    const used = session.hintUsed || 0;
    const pen = session.hintPenalty || 0;
    if (used) {
      ui.winHints.hidden = false;
      ui.winHints.textContent = `Hints: ${used} (−${formatScore(pen)})`;
    } else {
      ui.winHints.hidden = true;
      ui.winHints.textContent = '';
    }
  }
  ui.winModal.hidden = false;
  ui.winModal.classList.add('is-open');
  document.body.classList.add('modal-open');
}

function closeWin() {
  ui.winModal.classList.remove('is-open');
  ui.winModal.hidden = true;
  document.body.classList.remove('modal-open');
}

function leaveToMenu() {
  stopClockLoop();
  stopHintPlayback();
  closeWin();
  if (session?.status === 'playing') {
    persist();
  } else {
    clearState(user.user_id);
  }
  if (session) pathClear(session);
  session = null;
  showScreen('menu');
  refreshMenuExtras();
  buildLevelCards();
}

function bindGlobal() {
  document.querySelectorAll('[data-action="open-settings"]').forEach((el) => {
    el.addEventListener('click', openSettings);
  });
  document.querySelectorAll('[data-action="close-settings"]').forEach((el) => {
    el.addEventListener('click', closeSettings);
  });
  ui.settingHints.addEventListener('change', () => {
    settings = saveSettings(user.user_id, {
      ...settings,
      hints: !!ui.settingHints.checked,
    });
    if (session && !ui.play.hidden) ui.btnHint.hidden = !settings.hints;
  });
  ui.btnResetScores.addEventListener('click', () => {
    if (!confirm('Reset all recent scores on this device? This cannot be undone.')) return;
    clearHistory(user.user_id);
    refreshMenuExtras();
    buildLevelCards();
    ui.settingsStatus.hidden = false;
    ui.settingsStatus.textContent = 'Scores cleared.';
  });
  ui.btnResume.addEventListener('click', resumeGame);
  ui.btnDiscard.addEventListener('click', () => {
    clearState(user.user_id);
    refreshMenuExtras();
  });
  ui.btnToMenu.addEventListener('click', leaveToMenu);
  ui.btnNew.addEventListener('click', () => {
    if (!session) return;
    if (session.found.length && !confirm('Start a new board? Progress on this one will be lost.')) {
      return;
    }
    clearState(user.user_id);
    startNewGame(session.level);
  });
  ui.btnHint.addEventListener('click', () => {
    if (!session || !settings.hints || hintPlaying) return;
    if (session.path?.length) return;
    const step = advanceHint(session);
    if (step.empty) {
      ui.pathHint.textContent = 'No more hints available';
      return;
    }
    if (step.charged) {
      paintHud(ui, session);
      persist();
    }
    playBoardHint(step.path, step.revealCount, step.charged);
  });
  ui.btnWinContinue.addEventListener('click', () => {
    // Keep finding on a cleared board; not resumable as unfinished
    if (session) markCleared(session);
    persist();
    closeWin();
  });
  ui.btnWinAgain.addEventListener('click', () => {
    closeWin();
    clearState(user.user_id);
    startNewGame(session.level);
  });
  ui.btnWinMenu.addEventListener('click', () => {
    clearState(user.user_id);
    leaveToMenu();
  });
  ui.settingsModal.addEventListener('click', (e) => {
    if (e.target === ui.settingsModal) closeSettings();
  });
  ui.winModal.addEventListener('click', (e) => {
    if (e.target === ui.winModal) closeWin();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) persist();
    lastTick = performance.now();
  });
  window.addEventListener('pagehide', () => persist());
  window.addEventListener('beforeunload', () => persist());
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

main();
