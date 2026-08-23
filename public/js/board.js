/**
 * 4×4 grid DOM + path gestures.
 * Hit zone = inner 80% of each tile; outer 20% is a dead border for diagonals.
 */

import { neighbors } from './grid.js?v=6';
import { tileLabel, tileValue, isMultiTile } from './scoring.js?v=6';

const INNER_HIT = 0.8;

/**
 * @param {HTMLElement} root
 * @param {string[]} grid
 * @param {{
 *   onStart: (index: number) => void,
 *   onExtend: (index: number) => void,
 *   onEnd: () => void,
 *   getPath: () => number[],
 * }} handlers
 */
export function mountBoard(root, grid, handlers) {
  root.innerHTML = '';
  root.classList.add('word-grid');
  root.setAttribute('role', 'grid');
  root.setAttribute('aria-label', 'Letter grid');

  for (let i = 0; i < 16; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tile';
    btn.dataset.index = String(i);
    btn.setAttribute('role', 'gridcell');
    const tile = grid[i] || '';
    const multi = isMultiTile(tile);
    if (multi) btn.classList.add('is-multi');
    btn.innerHTML = `
      <span class="tile-letter${multi ? ' tile-multi-text' : ''}">${escapeHtml(tileLabel(tile))}</span>
      <span class="tile-value" aria-hidden="true">${tileValue(tile)}</span>
    `;
    root.appendChild(btn);
  }

  let drawing = false;
  let pointerId = null;
  /** @type {{ i: number, x: number, y: number, halfW: number, halfH: number }[]|null} */
  let centers = null;
  let hintTimer = 0;
  let hintToken = 0;
  /** @type {(() => void)|null} */
  let hintFinish = null;

  function measureCenters() {
    centers = [];
    root.querySelectorAll('.tile').forEach((el) => {
      const r = el.getBoundingClientRect();
      centers.push({
        i: Number(el.dataset.index),
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        halfW: r.width / 2,
        halfH: r.height / 2,
      });
    });
  }

  function centerOf(index) {
    if (!centers) measureCenters();
    return centers.find((c) => c.i === index) || null;
  }

  function inInnerHit(c, clientX, clientY) {
    if (!c || c.halfW <= 0 || c.halfH <= 0) return false;
    const nx = Math.abs(clientX - c.x) / c.halfW;
    const ny = Math.abs(clientY - c.y) / c.halfH;
    return nx <= INNER_HIT && ny <= INNER_HIT;
  }

  function normDist(c, clientX, clientY) {
    const nx = Math.abs(clientX - c.x) / c.halfW;
    const ny = Math.abs(clientY - c.y) / c.halfH;
    return Math.max(nx, ny);
  }

  function pickIndex(clientX, clientY) {
    if (!centers) measureCenters();
    const path = handlers.getPath() || [];
    const inside = centers.filter((c) => inInnerHit(c, clientX, clientY));

    if (!path.length) {
      if (!inside.length) return -1;
      inside.sort((a, b) => normDist(a, clientX, clientY) - normDist(b, clientX, clientY));
      return inside[0].i;
    }

    const last = path[path.length - 1];
    const lastC = centerOf(last);
    if (lastC && inInnerHit(lastC, clientX, clientY)) return last;

    const allowed = new Set(neighbors(last));
    if (path.length >= 2) allowed.add(path[path.length - 2]);

    let best = -1;
    let bestD = Infinity;
    for (const c of inside) {
      if (c.i === last) continue;
      if (!allowed.has(c.i)) continue;
      if (path.includes(c.i) && !(path.length >= 2 && path[path.length - 2] === c.i)) {
        continue;
      }
      const d = normDist(c, clientX, clientY);
      if (d < bestD) {
        bestD = d;
        best = c.i;
      }
    }
    return best >= 0 ? best : last;
  }

  function paintPath() {
    paintPathOn(root, handlers.getPath() || []);
  }

  function tileEl(index) {
    return root.querySelector(`.tile[data-index="${index}"]`);
  }

  function stripHintClasses() {
    root.querySelectorAll('.tile.is-hint-flash').forEach((el) => {
      el.classList.remove('is-hint-flash');
    });
  }

  function abortHintFlash() {
    hintToken += 1;
    if (hintTimer) {
      clearTimeout(hintTimer);
      hintTimer = 0;
    }
    stripHintClasses();
    const fn = hintFinish;
    hintFinish = null;
    fn?.();
  }

  /**
   * Sequential tile flash for hints. Returns a cancel function that also fires onDone.
   * @param {number[]} indices
   * @param {{
   *   onMs?: number,
   *   gapMs?: number,
   *   cycleGapMs?: number,
   *   cycles?: number,
   *   reducedMs?: number,
   *   onDone?: () => void,
   * }} [opts]
   */
  function playHintFlash(indices, opts = {}) {
    abortHintFlash();
    const list = Array.isArray(indices)
      ? indices.filter((i) => Number.isInteger(i) && i >= 0 && i <= 15)
      : [];
    const onDone = typeof opts.onDone === 'function' ? opts.onDone : null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      hintFinish = null;
      hintToken += 1;
      if (hintTimer) {
        clearTimeout(hintTimer);
        hintTimer = 0;
      }
      stripHintClasses();
      onDone?.();
    };
    hintFinish = finish;

    if (!list.length) {
      finish();
      return abortHintFlash;
    }

    const token = hintToken;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      for (const i of list) tileEl(i)?.classList.add('is-hint-flash');
      hintTimer = window.setTimeout(finish, opts.reducedMs ?? 800);
      return abortHintFlash;
    }

    const onMs = opts.onMs ?? 500;
    const gapMs = opts.gapMs ?? 80;
    const cycleGapMs = opts.cycleGapMs ?? 250;
    const cycles = Math.max(1, opts.cycles ?? 2);

    /** @type {{ type: string, ms?: number, index?: number }[]} */
    const events = [];
    for (let c = 0; c < cycles; c++) {
      if (c > 0) events.push({ type: 'wait', ms: cycleGapMs });
      for (let i = 0; i < list.length; i++) {
        if (i > 0) events.push({ type: 'wait', ms: gapMs });
        events.push({ type: 'on', index: list[i] });
        events.push({ type: 'wait', ms: onMs });
        events.push({ type: 'off', index: list[i] });
      }
    }

    let k = 0;
    const run = () => {
      if (token !== hintToken || settled) return;
      while (k < events.length) {
        const ev = events[k++];
        if (ev.type === 'on') {
          tileEl(ev.index)?.classList.add('is-hint-flash');
          continue;
        }
        if (ev.type === 'off') {
          tileEl(ev.index)?.classList.remove('is-hint-flash');
          continue;
        }
        hintTimer = window.setTimeout(run, ev.ms || 0);
        return;
      }
      finish();
    };
    run();
    return abortHintFlash;
  }

  function onDown(e) {
    if (e.button != null && e.button !== 0) return;
    abortHintFlash();
    measureCenters();
    const idx = pickIndex(e.clientX, e.clientY);
    if (idx < 0) return;
    drawing = true;
    pointerId = e.pointerId;
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    handlers.onStart(idx);
    paintPath();
    e.preventDefault();
  }

  function onMove(e) {
    if (!drawing) return;
    if (pointerId != null && e.pointerId !== pointerId) return;
    if (!centers) measureCenters();
    const idx = pickIndex(e.clientX, e.clientY);
    if (idx < 0) return;
    const path = handlers.getPath() || [];
    if (!path.length) handlers.onStart(idx);
    else if (path[path.length - 1] !== idx) handlers.onExtend(idx);
    paintPath();
    e.preventDefault();
  }

  function onUp(e) {
    if (!drawing) return;
    if (pointerId != null && e.pointerId !== pointerId) return;
    drawing = false;
    pointerId = null;
    try {
      root.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    handlers.onEnd();
    paintPath();
  }

  function onLostCapture() {
    if (drawing) {
      drawing = false;
      pointerId = null;
      handlers.onEnd();
      paintPath();
    }
  }

  function onResize() {
    centers = null;
  }

  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);
  root.addEventListener('lostpointercapture', onLostCapture);
  window.addEventListener('resize', onResize);
  root.style.touchAction = 'none';

  return {
    paintPath,
    playHintFlash,
    clearHintFlash: abortHintFlash,
    setFlash(kind) {
      root.classList.remove('flash-ok', 'flash-bad', 'flash-dup');
      if (kind) {
        root.classList.add(`flash-${kind}`);
        window.setTimeout(() => root.classList.remove(`flash-${kind}`), 280);
      }
    },
    destroy() {
      hintFinish = null;
      abortHintFlash();
      window.removeEventListener('resize', onResize);
      centers = null;
      root.innerHTML = '';
    },
  };
}

/**
 * @param {HTMLElement} root
 * @param {number[]} path
 */
export function paintPathOn(root, path) {
  const list = path || [];
  const set = new Set(list);
  root.querySelectorAll('.tile').forEach((el) => {
    const i = Number(el.dataset.index);
    el.classList.toggle('is-path', set.has(i));
    el.classList.toggle('is-path-end', list.length > 0 && list[list.length - 1] === i);
    const order = list.indexOf(i);
    if (order >= 0) el.dataset.order = String(order + 1);
    else delete el.dataset.order;
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
