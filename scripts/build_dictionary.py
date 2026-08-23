#!/usr/bin/env python3
"""Build public/data/dictionary.json from a common-word list.

Default source is dolph/dictionary popular.txt: ENABLE (game-valid) intersected
with Wiktionary TV/movie frequency — ordinary English, not a full spellcheck dump.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "data" / "dictionary.json"

POPULAR_URL = (
    "https://raw.githubusercontent.com/dolph/dictionary/master/popular.txt"
)
# Fallback: large unfiltered alpha list (only if popular.txt cannot be fetched)
ENABLE_URL = (
    "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt"
)

WORD_RE = re.compile(r"^[a-z]{3,15}$")


def load_lines(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="ignore")
    return text.splitlines()


def filter_words(lines: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        w = line.strip().lower()
        if not WORD_RE.match(w):
            continue
        if w in seen:
            continue
        seen.add(w)
        out.append(w)
    out.sort()
    return out


def from_system_dict() -> list[str]:
    path = Path("/usr/share/dict/words")
    if not path.is_file():
        return []
    lines = []
    for line in load_lines(path):
        raw = line.strip()
        if not raw:
            continue
        if raw.isalpha() and raw.islower():
            lines.append(raw)
        elif raw.isalpha() and raw.isupper():
            lines.append(raw.lower())
    words = filter_words(lines)
    if len(words) < 20000:
        words = filter_words(load_lines(path))
    return words


def from_url(url: str) -> list[str]:
    print(f"→ Downloading {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=60) as resp:
        text = resp.read().decode("utf-8", errors="ignore")
    return filter_words(text.splitlines())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--source",
        choices=("auto", "popular", "system", "enable"),
        default="auto",
        help="Word source (default: auto = popular.txt, then system, then enable)",
    )
    ap.add_argument("-o", "--output", type=Path, default=OUT)
    args = ap.parse_args()

    words: list[str] = []
    source_used = ""

    if args.source in ("auto", "popular"):
        try:
            words = from_url(POPULAR_URL)
            source_used = "popular"
            print(f"→ Popular list: {len(words)} words", file=sys.stderr)
        except Exception as exc:  # noqa: BLE001
            print(f"→ Popular download failed: {exc}", file=sys.stderr)
            if args.source == "popular":
                return 1

    if args.source == "system" or (args.source == "auto" and len(words) < 15000):
        sys_words = from_system_dict()
        print(f"→ System dict: {len(sys_words)} words", file=sys.stderr)
        if len(sys_words) > len(words):
            words = sys_words
            source_used = "system"

    if args.source == "enable" or (args.source == "auto" and len(words) < 15000):
        try:
            remote = from_url(ENABLE_URL)
            print(f"→ Remote enable list: {len(remote)} words", file=sys.stderr)
            if len(remote) > len(words):
                words = remote
                source_used = "enable"
        except Exception as exc:  # noqa: BLE001
            print(f"→ Remote download failed: {exc}", file=sys.stderr)
            if not words:
                return 1

    if len(words) < 5000:
        print("Dictionary too small", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(words, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(words)} words ({source_used or args.source}) → {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
