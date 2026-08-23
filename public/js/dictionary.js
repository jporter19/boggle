/** Dictionary load + lookup. */

/** @type {Set<string>|null} */
let wordSet = null;
/** @type {Set<string>|null} */
let prefixSet = null;

/**
 * Load dictionary.json (array of lowercase words).
 * @returns {Promise<Set<string>>}
 */
export async function loadDictionary() {
  if (wordSet) return wordSet;
  const res = await fetch('data/dictionary.json', { cache: 'force-cache' });
  if (!res.ok) throw new Error(`dictionary ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('dictionary must be an array');
  wordSet = new Set();
  prefixSet = new Set();
  for (const raw of data) {
    const w = String(raw).toLowerCase();
    wordSet.add(w);
    for (let i = 1; i < w.length; i++) {
      prefixSet.add(w.slice(0, i));
    }
  }
  return wordSet;
}

/**
 * @param {string} word
 * @returns {boolean}
 */
export function isWord(word) {
  if (!wordSet) return false;
  return wordSet.has((word || '').toLowerCase());
}

/**
 * True if some dictionary word continues from this prefix.
 * @param {string} prefix
 */
export function hasPrefix(prefix) {
  if (!prefixSet) return false;
  const p = (prefix || '').toLowerCase();
  if (!p) return true;
  return prefixSet.has(p) || (wordSet && wordSet.has(p));
}

export function dictionarySize() {
  return wordSet ? wordSet.size : 0;
}

export function getDictionary() {
  return wordSet;
}
