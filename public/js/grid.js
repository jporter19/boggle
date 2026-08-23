/** 4×4 grid geometry and path → word expansion. */

import { tileLetters } from './scoring.js?v=6';

export const GRID_SIZE = 4;
export const CELL_COUNT = 16;

/** @type {number[][]} */
const NEIGHBORS = (() => {
  const all = [];
  for (let i = 0; i < CELL_COUNT; i++) {
    const r = Math.floor(i / GRID_SIZE);
    const c = i % GRID_SIZE;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
        out.push(nr * GRID_SIZE + nc);
      }
    }
    all.push(out);
  }
  return all;
})();

/**
 * @param {number} index
 * @returns {number[]}
 */
export function neighbors(index) {
  return NEIGHBORS[index] || [];
}

/**
 * @param {number} a
 * @param {number} b
 */
export function isAdjacent(a, b) {
  return neighbors(a).includes(b);
}

/**
 * @param {string[]} grid
 * @param {number[]} path
 */
export function pathToWord(grid, path) {
  let w = '';
  for (const i of path) {
    w += tileLetters(grid[i]);
  }
  return w;
}
