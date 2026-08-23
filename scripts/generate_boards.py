#!/usr/bin/env python3
"""Generate Word Paths board bank from shared rules.json + dictionary."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DICT_PATH = ROOT / "public" / "data" / "dictionary.json"
RULES_PATH = ROOT / "public" / "data" / "rules.json"
OUT_PATH = ROOT / "public" / "data" / "boards.json"

BAGS = {
    "easy": (
        "EEEEEEEEEEEEAAAAAAAAAIIIIIIIIIOOOOOOOONNNNNNRRRRRRTTTTTT"
        "SSSSSSLLLLLDUUUUDDDGGG"
        "BBCCMMPPFFHHYYWWKVJX"
    ),
    "medium": (
        "EEEEEEEEEEAAAAAAAIIIIIIIOOOOOONNNNNNRRRRRTTTTSSSSLLLL"
        "DUUGGGBBCCMMPPFFHHYYWWKVJXZ"
    ),
    "hard": (
        "EEEEEEEAAAAAIIIIIOOOOONNNNRRRRTTTTSSSSLLLDUUGG"
        "BBCCMMPPFFHHYYWWKKVVJJXXZZ"
    ),
    "expert": (
        "EEEEEAAAAIIIIOOOONNNRRRTTTSSSLDUGG"
        "BBCCMMPPFFHHYYWWKKVVJJXXZZYY"
    ),
}

MULTI_P = {"easy": 0.35, "medium": 0.45, "hard": 0.55, "expert": 0.60}

LEVEL_FILTERS = {
    "easy": {"min_total": 28, "max_total": 100, "min_ge5": 3},
    "medium": {"min_total": 50, "max_total": 150, "min_ge5": 6, "min_ge6": 2},
    "hard": {"min_total": 70, "max_total": 220, "min_ge5": 10, "min_ge6": 3, "min_ge7": 1},
    "expert": {"min_total": 85, "max_total": 400, "min_ge5": 12, "min_ge6": 4, "min_ge7": 1},
}

LEN_POOLS = {
    "easy": [3, 4, 5],
    "medium": [4, 5, 6],
    "hard": [5, 6, 7],
    "expert": [6, 7, 8, 9],
}

POINT_FRAC = {"easy": 0.22, "medium": 0.28, "hard": 0.34, "expert": 0.40}
WORD_FRAC = {"easy": 0.28, "medium": 0.32, "hard": 0.36, "expert": 0.40}
LEN_COUNT_FRAC = {"easy": 0.30, "medium": 0.35, "hard": 0.40, "expert": 0.45}


class Rules:
    def __init__(self, data: dict) -> None:
        self.letter_values: dict[str, int] = {
            k: int(v) for k, v in (data.get("letterValues") or {}).items()
        }
        self.length_mult: dict[int, float] = {
            int(k): float(v) for k, v in (data.get("lengthMult") or {}).items()
        }
        self.min_word_len = int(data.get("minWordLen") or 3)
        self.multi: list[dict] = list(data.get("multiTiles") or [])
        self._multi_map: dict[str, dict] = {}
        for m in self.multi:
            entry = {
                "id": m["id"],
                "letters": str(m["letters"]).lower(),
                "value": int(m["value"]),
                "label": m.get("label") or m["id"],
            }
            self._multi_map[str(m["id"]).lower()] = entry
            self._multi_map[entry["letters"]] = entry

    def tile_letters(self, tile: str) -> str:
        low = str(tile).lower()
        m = self._multi_map.get(low)
        return m["letters"] if m else low

    def tile_value(self, tile: str) -> int:
        low = str(tile).lower()
        m = self._multi_map.get(low)
        if m:
            return m["value"]
        return self.letter_values.get(low, 0)

    def is_multi(self, tile: str) -> bool:
        return str(tile).lower() in self._multi_map

    def multi_label(self, multi_id: str) -> str | None:
        m = self._multi_map.get(str(multi_id).lower())
        return m["label"] if m else None

    def score_path(self, grid: list[str], path: list[int]) -> int:
        base = 0
        word = ""
        for i in path:
            base += self.tile_value(grid[i])
            word += self.tile_letters(grid[i])
        if len(word) < self.min_word_len:
            return 0
        mult = self.length_mult.get(len(word), max(7, len(word) - 3))
        return int(round(base * mult))


class TrieNode:
    __slots__ = ("kids", "end")

    def __init__(self) -> None:
        self.kids: dict[str, TrieNode] = {}
        self.end = False


def build_trie(words: list[str]) -> TrieNode:
    root = TrieNode()
    for w in words:
        node = root
        for ch in w:
            if ch not in node.kids:
                node.kids[ch] = TrieNode()
            node = node.kids[ch]
        node.end = True
    return root


def make_grid(rng: random.Random, level: str, rules: Rules) -> tuple[list[str], str | None]:
    bag = BAGS[level]
    grid: list[str] = []
    multi_id: str | None = None
    multi_idx = -1
    if rules.multi and rng.random() < MULTI_P[level]:
        spec = rng.choice(rules.multi)
        multi_id = spec["id"]
        multi_idx = rng.randrange(16)

    for i in range(16):
        if i == multi_idx and multi_id:
            grid.append(multi_id)
        else:
            ch = bag[rng.randrange(len(bag))]
            if ch.upper() == "Q":
                ch = "A"
            grid.append(ch)
    return grid, multi_id


def solve(
    grid: list[str], trie: TrieNode, rules: Rules
) -> tuple[set[str], dict[str, int], dict[str, bool]]:
    found: set[str] = set()
    best_score: dict[str, int] = {}
    uses_multi: dict[str, bool] = {}
    letters = [rules.tile_letters(t) for t in grid]
    multi_mask = [rules.is_multi(t) for t in grid]

    neigh = [[] for _ in range(16)]
    for i in range(16):
        r, c = divmod(i, 4)
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                nr, nc = r + dr, c + dc
                if 0 <= nr < 4 and 0 <= nc < 4:
                    neigh[i].append(nr * 4 + nc)

    def dfs(
        idx: int,
        node: TrieNode,
        path_mask: int,
        word: str,
        path: list[int],
        multi: bool,
    ) -> None:
        chunk = letters[idx]
        cur = node
        for ch in chunk:
            if ch not in cur.kids:
                return
            cur = cur.kids[ch]
        word2 = word + chunk
        path2 = path + [idx]
        multi2 = multi or multi_mask[idx]
        if cur.end and len(word2) >= rules.min_word_len:
            found.add(word2)
            sc = rules.score_path(grid, path2)
            if sc > best_score.get(word2, 0):
                best_score[word2] = sc
            if multi2:
                uses_multi[word2] = True
            else:
                uses_multi.setdefault(word2, False)
        mask = path_mask | (1 << idx)
        for j in neigh[idx]:
            if mask & (1 << j):
                continue
            dfs(j, cur, mask, word2, path2, multi2)

    for start in range(16):
        dfs(start, trie, 0, "", [], False)
    return found, best_score, uses_multi


def stats_for(
    words: set[str], best_score: dict[str, int], uses_multi: dict[str, bool]
) -> dict:
    lengths = [len(w) for w in words]
    by_len: dict[str, int] = defaultdict(int)
    for n in lengths:
        by_len[str(n)] += 1
    return {
        "total": len(words),
        "totalPoints": sum(best_score.get(w, 0) for w in words),
        "multiWords": sum(1 for w in words if uses_multi.get(w)),
        "ge5": sum(1 for n in lengths if n >= 5),
        "ge6": sum(1 for n in lengths if n >= 6),
        "ge7": sum(1 for n in lengths if n >= 7),
        "ge8": sum(1 for n in lengths if n >= 8),
        "longest": max(lengths) if lengths else 0,
        "by_len": dict(by_len),
    }


def accepts(level: str, st: dict) -> bool:
    f = LEVEL_FILTERS[level]
    if st["total"] < f["min_total"] or st["total"] > f["max_total"]:
        return False
    if st["ge5"] < f.get("min_ge5", 0):
        return False
    if st["ge6"] < f.get("min_ge6", 0):
        return False
    if st["ge7"] < f.get("min_ge7", 0):
        return False
    return True


def count_len(by_len: dict, mode: str, L: int) -> int:
    if mode == "exact":
        return int(by_len.get(str(L), 0))
    return sum(int(by_len.get(str(n), 0)) for n in range(L, 16))


def make_goals(
    rng: random.Random,
    level: str,
    st: dict,
    multi_id: str | None,
    rules: Rules,
) -> dict:
    """Always: points + wordLen. Optional: words, multiWords."""
    by_len = st.get("by_len") or {}
    goals: dict = {}

    total_pts = max(1, int(st.get("totalPoints") or 0))
    frac = POINT_FRAC[level] * rng.uniform(0.85, 1.15)
    pts = max(20, int(round(total_pts * frac)))
    goals["points"] = min(pts, total_pts)

    pool = list(LEN_POOLS[level])
    rng.shuffle(pool)
    prefer_exact = level in ("easy", "medium") and rng.random() < 0.55
    chosen = None
    for L in pool:
        if L < 3 or L > 10:
            continue
        mode = "exact" if prefer_exact else "min"
        for try_mode in (
            [mode, "min", "exact"] if prefer_exact else [mode, "exact", "min"]
        ):
            avail = count_len(by_len, try_mode, L)
            if avail < 1:
                continue
            need = max(1, int(round(avail * LEN_COUNT_FRAC[level])))
            need = min(need, avail)
            floor = {"easy": 1, "medium": 2, "hard": 2, "expert": 3}[level]
            if try_mode == "exact" and L >= 7:
                floor = 1
            need = (
                max(min(floor, avail), need)
                if avail >= floor
                else max(1, min(need, avail))
            )
            chosen = {"len": L, "count": need, "mode": try_mode}
            break
        if chosen:
            break
    if not chosen:
        avail = st["total"]
        chosen = {
            "len": 3,
            "count": max(1, min(5, int(avail * 0.2))),
            "mode": "min",
        }
    goals["wordLen"] = chosen

    if rng.random() < {"easy": 0.45, "medium": 0.55, "hard": 0.70, "expert": 0.85}[level]:
        wneed = max(
            {"easy": 8, "medium": 12, "hard": 18, "expert": 24}[level],
            int(round(st["total"] * WORD_FRAC[level])),
        )
        goals["words"] = min(wneed, st["total"])

    multi_avail = int(st.get("multiWords") or 0)
    if multi_id and multi_avail >= 1:
        if rng.random() < {"easy": 0.5, "medium": 0.65, "hard": 0.8, "expert": 0.9}[level]:
            frac_m = {"easy": 0.25, "medium": 0.28, "hard": 0.30, "expert": 0.32}[level]
            cap = {"easy": 2, "medium": 3, "hard": 4, "expert": 5}[level]
            goals["multiWords"] = max(
                1, min(multi_avail, cap, int(round(multi_avail * frac_m)))
            )
            label = rules.multi_label(multi_id)
            if label:
                goals["multiLabel"] = label

    return goals


def validate_goals(goals: dict) -> bool:
    if not isinstance(goals.get("points"), (int, float)) or goals["points"] < 1:
        return False
    wl = goals.get("wordLen") or {}
    if not isinstance(wl.get("len"), int) or not (3 <= wl["len"] <= 10):
        return False
    if not isinstance(wl.get("count"), int) or wl["count"] < 1:
        return False
    if wl.get("mode") not in ("exact", "min"):
        return False
    return True


def board_id(grid: list[str], level: str) -> str:
    raw = level + "|" + "".join(grid)
    return hashlib.sha1(raw.encode()).hexdigest()[:12]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--per-level", type=int, default=200)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--dict", type=Path, default=DICT_PATH)
    ap.add_argument("--rules", type=Path, default=RULES_PATH)
    ap.add_argument("-o", "--output", type=Path, default=OUT_PATH)
    ap.add_argument("--max-attempts", type=int, default=100000)
    args = ap.parse_args()

    if not args.rules.is_file():
        print(f"Missing rules: {args.rules}", file=sys.stderr)
        return 1
    if not args.dict.is_file():
        print(f"Missing dictionary: {args.dict}", file=sys.stderr)
        print("Run: python3 scripts/build_dictionary.py", file=sys.stderr)
        return 1

    rules = Rules(json.loads(args.rules.read_text(encoding="utf-8")))
    words = json.loads(args.dict.read_text(encoding="utf-8"))
    print(f"→ Rules multi-tiles={len(rules.multi)} dict={len(words)}", file=sys.stderr)
    trie = build_trie(words)

    rng = random.Random(args.seed)
    levels = ["easy", "medium", "hard", "expert"]
    collected: dict[str, list[dict]] = {lv: [] for lv in levels}
    seen_grids: set[str] = set()
    attempts = 0
    t0 = time.time()

    while any(len(collected[lv]) < args.per_level for lv in levels):
        attempts += 1
        if attempts > args.max_attempts:
            break
        need = [lv for lv in levels if len(collected[lv]) < args.per_level]
        level = rng.choice(need)
        grid, multi_id = make_grid(rng, level, rules)
        key = "".join(grid)
        if key in seen_grids:
            continue
        found, best_score, uses_multi = solve(grid, trie, rules)
        st = stats_for(found, best_score, uses_multi)
        if not accepts(level, st):
            placed = False
            for alt in need:
                if alt != level and accepts(alt, st):
                    level = alt
                    placed = True
                    break
            if not placed and not accepts(level, st):
                continue
        if len(collected[level]) >= args.per_level:
            continue
        seen_grids.add(key)
        goals = make_goals(rng, level, st, multi_id, rules)
        if goals.get("points", 0) > st["totalPoints"]:
            goals["points"] = st["totalPoints"]
        if not validate_goals(goals):
            continue
        collected[level].append(
            {
                "id": board_id(grid, level),
                "level": level,
                "grid": grid,
                "multiTile": multi_id,
                "goals": goals,
                "stats": {
                    "total": st["total"],
                    "totalPoints": st["totalPoints"],
                    "multiWords": st["multiWords"],
                    "ge5": st["ge5"],
                    "ge6": st["ge6"],
                    "ge7": st["ge7"],
                    "ge8": st["ge8"],
                    "longest": st["longest"],
                    "by_len": st["by_len"],
                },
            }
        )
        if attempts % 200 == 0:
            print(
                f"  attempts={attempts} filled={{ {', '.join(f'{k}:{len(v)}' for k,v in collected.items())} }}",
                file=sys.stderr,
            )

    boards: list[dict] = []
    for lv in levels:
        boards.extend(collected[lv])
        print(f"→ {lv}: {len(collected[lv])} boards", file=sys.stderr)

    if not boards:
        print("No boards generated", file=sys.stderr)
        return 1

    payload = {
        "version": 2,
        "generated_at": int(time.time()),
        "seed": args.seed,
        "dictionary_size": len(words),
        "rules_version": 2,
        "per_level_target": args.per_level,
        "boards": boards,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(
        f"Wrote {len(boards)} boards → {args.output} "
        f"({attempts} attempts, {time.time() - t0:.1f}s)"
    )
    short = [lv for lv in levels if len(collected[lv]) < args.per_level]
    if short:
        print(f"Warning: under-filled levels: {short}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
