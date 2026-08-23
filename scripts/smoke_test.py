#!/usr/bin/env python3
"""Word Paths: module graph, rules/boards integrity, scoring + goals checks."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "public" / "js"
DATA = ROOT / "public" / "data"


def check_exports() -> list[str]:
    errors: list[str] = []
    exports: dict[str, set[str]] = {}
    for path in JS.glob("*.js"):
        src = path.read_text()
        exp: set[str] = set()
        for m in re.finditer(
            r"export\s+(?:async\s+)?function\s+(\w+)"
            r"|export\s+(?:const|let|var|class)\s+(\w+)"
            r"|export\s*\{([^}]+)\}",
            src,
        ):
            if m.group(1):
                exp.add(m.group(1))
            if m.group(2):
                exp.add(m.group(2))
            if m.group(3):
                for part in m.group(3).split(","):
                    name = part.strip().split(" as ")[0].strip()
                    if name:
                        exp.add(name)
        exports[path.name] = exp

    for path in JS.glob("*.js"):
        src = path.read_text()
        for m in re.finditer(r"import\s*\{([^}]+)\}\s*from\s*'\./([^'?]+)", src):
            names = [
                p.strip().split(" as ")[0].strip()
                for p in m.group(1).split(",")
                if p.strip()
            ]
            mod = m.group(2)
            if mod not in exports:
                errors.append(f"{path.name}: missing module {mod}")
                continue
            for n in names:
                if n not in exports[mod]:
                    errors.append(f"{path.name}: {mod} missing export {n}")
    return errors


def check_import_versions() -> list[str]:
    """All relative imports must use the current ASSET_V query."""
    errors: list[str] = []
    version_src = (JS / "version.js").read_text()
    m = re.search(r"ASSET_V\s*=\s*(\d+)", version_src)
    if not m:
        return ["version.js missing ASSET_V"]
    want = m.group(1)
    for path in JS.glob("*.js"):
        src = path.read_text()
        for im in re.finditer(r"from\s+'\./([^']+)'", src):
            spec = im.group(1)
            if not spec.endswith(".js") and "?v=" not in spec:
                # version.js may have no imports
                continue
            if "?v=" not in spec:
                errors.append(f"{path.name}: import missing ?v= → {spec}")
            elif f"?v={want}" not in spec:
                errors.append(f"{path.name}: import not ?v={want} → {spec}")
    return errors


def load_rules() -> dict:
    return json.loads((DATA / "rules.json").read_text(encoding="utf-8"))


def score_path(rules: dict, grid: list[str], path: list[int]) -> int:
    letter_values = rules["letterValues"]
    multi = {
        str(m["id"]).lower(): m for m in rules["multiTiles"]
    }
    multi.update({str(m["letters"]).lower(): m for m in rules["multiTiles"]})
    length_mult = {int(k): float(v) for k, v in rules["lengthMult"].items()}
    min_len = int(rules.get("minWordLen") or 3)

    def tile_letters(t: str) -> str:
        low = t.lower()
        if low in multi:
            return multi[low]["letters"]
        return low

    def tile_value(t: str) -> int:
        low = t.lower()
        if low in multi:
            return int(multi[low]["value"])
        return int(letter_values.get(low, 0))

    base = 0
    word = ""
    for i in path:
        base += tile_value(grid[i])
        word += tile_letters(grid[i])
    if len(word) < min_len:
        return 0
    mult = length_mult.get(len(word), max(7, len(word) - 3))
    return int(round(base * mult))


def check_data() -> list[str]:
    errors: list[str] = []
    rules_path = DATA / "rules.json"
    dict_path = DATA / "dictionary.json"
    boards_path = DATA / "boards.json"
    if not rules_path.is_file():
        errors.append("missing rules.json")
        return errors
    if not dict_path.is_file():
        errors.append("missing dictionary.json")
        return errors
    if not boards_path.is_file():
        errors.append("missing boards.json")
        return errors

    rules = load_rules()
    if not rules.get("multiTiles") or not rules.get("letterValues"):
        errors.append("rules.json incomplete")

    words = json.loads(dict_path.read_text(encoding="utf-8"))
    if not isinstance(words, list) or len(words) < 20000:
        errors.append(f"dictionary too small: {len(words) if isinstance(words, list) else type(words)}")

    payload = json.loads(boards_path.read_text(encoding="utf-8"))
    boards = payload.get("boards") if isinstance(payload, dict) else None
    if not isinstance(boards, list) or not boards:
        errors.append("boards.json has no boards")
        return errors

    multi_ids = {m["id"] for m in rules["multiTiles"]}
    multi_ids |= {m["id"].lower() for m in rules["multiTiles"]}
    by_level: dict[str, int] = {}
    multi_boards = 0

    for b in boards:
        lv = b.get("level")
        by_level[lv] = by_level.get(lv, 0) + 1
        grid = b.get("grid")
        goals = b.get("goals") or {}
        stats = b.get("stats") or {}
        if not isinstance(grid, list) or len(grid) != 16:
            errors.append(f"board {b.get('id')}: bad grid")
            continue

        multi_count = sum(1 for t in grid if str(t) in multi_ids or str(t).lower() in multi_ids)
        if multi_count > 1:
            errors.append(f"board {b.get('id')}: {multi_count} multi tiles")
        if multi_count == 1:
            multi_boards += 1

        # Goal contract (current version only)
        if not isinstance(goals.get("points"), (int, float)) or goals["points"] < 1:
            errors.append(f"board {b.get('id')}: missing points goal")
        wl = goals.get("wordLen")
        if not isinstance(wl, dict):
            errors.append(f"board {b.get('id')}: missing wordLen")
        else:
            L = wl.get("len")
            if not isinstance(L, int) or L < 3 or L > 10:
                errors.append(f"board {b.get('id')}: wordLen.len out of range")
            if not isinstance(wl.get("count"), int) or wl["count"] < 1:
                errors.append(f"board {b.get('id')}: wordLen.count invalid")
            if wl.get("mode") not in ("exact", "min"):
                errors.append(f"board {b.get('id')}: wordLen.mode invalid")
        # Legacy keys must not reappear
        for legacy in ("minLen5", "minLen6", "minLen7", "minLen8"):
            if legacy in goals:
                errors.append(f"board {b.get('id')}: legacy goal {legacy}")

        total = int(stats.get("total") or 0)
        if total < 1:
            errors.append(f"board {b.get('id')}: stats.total missing")
        if goals.get("words") and goals["words"] > total:
            errors.append(f"board {b.get('id')}: words goal exceeds total")
        if goals.get("points") and stats.get("totalPoints") and goals["points"] > stats["totalPoints"]:
            errors.append(f"board {b.get('id')}: points exceeds totalPoints")

    for lv in ("easy", "medium", "hard", "expert"):
        if by_level.get(lv, 0) < 10:
            errors.append(f"level {lv} has only {by_level.get(lv, 0)} boards")

    if multi_boards < 10:
        errors.append(f"too few multi-tile boards: {multi_boards}")

    # Scoring: Qu tile alone path of one is short; use a simple single-letter path
    grid = ["C", "A", "T", "E"] + ["A"] * 12
    sc = score_path(rules, grid, [0, 1, 2])  # CAT
    # C=3 A=1 T=1 base=5 * mult3=1 → 5
    if sc != 5:
        errors.append(f"scorePath CAT expected 5 got {sc}")

    # Multi tile Qu value 15 in base for "qu" only is short; path Qu+I+T if present
    qu_val = next(m["value"] for m in rules["multiTiles"] if m["id"] == "Qu")
    if qu_val < 10 or qu_val > 20:
        errors.append(f"Qu value out of expected bonus range: {qu_val}")

    print(
        f"  dictionary={len(words)} boards={len(boards)} by_level={by_level} multi_boards={multi_boards}"
    )
    return errors


def main() -> int:
    errors: list[str] = []
    print("→ Export/import graph")
    errors.extend(check_exports())
    print("→ Import cache versions")
    errors.extend(check_import_versions())
    print("→ Data integrity + scoring")
    errors.extend(check_data())
    if errors:
        print("FAIL:")
        for e in errors:
            print(f"  - {e}")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
