/** Board bank load + pick by level. */

import { normalizeGoals } from './scoring.js?v=6';

/** @type {object|null} */
let bank = null;

export async function loadBank() {
  if (bank) return bank;
  const res = await fetch('data/boards.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`boards ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.boards)) {
    throw new Error('boards.json missing boards array');
  }
  bank = data;
  return bank;
}

/**
 * @param {object} bankData
 * @param {string} levelId
 * @param {string[]} recentIds
 */
export function pickPuzzle(bankData, levelId, recentIds = []) {
  const boards = (bankData?.boards || []).filter((b) => b.level === levelId);
  if (!boards.length) throw new Error(`No boards for level ${levelId}`);
  const recent = new Set(recentIds || []);
  const fresh = boards.filter((b) => !recent.has(b.id));
  const pool = fresh.length ? fresh : boards;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const goals = normalizeGoals(pick.goals);
  if (!goals) throw new Error(`Board ${pick.id} has invalid goals`);
  return {
    id: pick.id,
    level: pick.level,
    grid: pick.grid.slice(),
    goals,
    stats: pick.stats ? { ...pick.stats } : { total: 0 },
    multiTile: pick.multiTile || null,
  };
}

export function findBoardById(bankData, id) {
  if (!bankData?.boards || !id) return null;
  return bankData.boards.find((b) => b.id === id) || null;
}

export function boardCount(bankData, levelId) {
  if (!bankData?.boards) return 0;
  if (!levelId) return bankData.boards.length;
  return bankData.boards.filter((b) => b.level === levelId).length;
}
