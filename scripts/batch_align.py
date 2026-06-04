#!/usr/bin/env python3
"""Batch-align BSB chapters.

Reads a CSV/list of (book_slug, chapter, audio_number) on stdin or args,
downloads each audio (caching to /tmp/sb-audio/), runs alignment, and writes
into ../app/public/bible-static/bsb-align/<book_slug>/<chapter>.json.

Usage:
  ./batch_align.py john:3 genesis:1 psalms:23 romans:8 revelation:22
  ./batch_align.py --all     # all 1189 chapters

Loads the alignment model once and reuses it across chapters.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import whisperx

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "app" / "public" / "bible-static" / "bsb"
ALIGN_DIR = ROOT / "app" / "public" / "bible-static" / "bsb-align"
AUDIO_CACHE = Path(__file__).resolve().parent.parent / "app" / "public" / "audio"
AUDIO_CACHE.mkdir(parents=True, exist_ok=True)
AUDIO_BASE = "https://benkaiser.github.io/bsb-plan-generator/audio_processed"

# Mirrors src/bibleData.tsx in benkaiser/bsb-plan-generator
BIBLE = [
    ("Genesis", 1, 50), ("Exodus", 51, 40), ("Leviticus", 91, 27), ("Numbers", 118, 36),
    ("Deuteronomy", 154, 34), ("Joshua", 188, 24), ("Judges", 212, 21), ("Ruth", 233, 4),
    ("1 Samuel", 237, 31), ("2 Samuel", 268, 24), ("1 Kings", 292, 22), ("2 Kings", 314, 25),
    ("1 Chronicles", 339, 29), ("2 Chronicles", 368, 36), ("Ezra", 404, 10), ("Nehemiah", 414, 13),
    ("Esther", 427, 10), ("Job", 437, 42), ("Psalms", 479, 150), ("Proverbs", 629, 31),
    ("Ecclesiastes", 660, 12), ("Song of Solomon", 672, 8), ("Isaiah", 680, 66), ("Jeremiah", 746, 52),
    ("Lamentations", 798, 5), ("Ezekiel", 803, 48), ("Daniel", 851, 12), ("Hosea", 863, 14),
    ("Joel", 877, 3), ("Amos", 880, 9), ("Obadiah", 889, 1), ("Jonah", 890, 4),
    ("Micah", 894, 7), ("Nahum", 901, 3), ("Habakkuk", 904, 3), ("Zephaniah", 907, 3),
    ("Haggai", 910, 2), ("Zechariah", 912, 14), ("Malachi", 926, 4),
    ("Matthew", 930, 28), ("Mark", 958, 16), ("Luke", 974, 24), ("John", 998, 21),
    ("Acts", 1019, 28), ("Romans", 1047, 16), ("1 Corinthians", 1063, 16), ("2 Corinthians", 1079, 13),
    ("Galatians", 1092, 6), ("Ephesians", 1098, 6), ("Philippians", 1104, 4), ("Colossians", 1108, 4),
    ("1 Thessalonians", 1112, 5), ("2 Thessalonians", 1117, 3), ("1 Timothy", 1120, 6),
    ("2 Timothy", 1126, 4), ("Titus", 1130, 3), ("Philemon", 1133, 1),
    ("Hebrews", 1134, 13), ("James", 1147, 5), ("1 Peter", 1152, 5), ("2 Peter", 1157, 3),
    ("1 John", 1160, 5), ("2 John", 1165, 1), ("3 John", 1166, 1), ("Jude", 1167, 1),
    ("Revelation", 1168, 22),
]

def slug(name: str) -> str:
    return name.lower().replace(" ", "_")

SLUG_TO_BOOK = {slug(n): (n, sf, ch) for (n, sf, ch) in BIBLE}


def all_chapters():
    for name, sf, ch in BIBLE:
        for c in range(1, ch + 1):
            yield slug(name), c, sf + c - 1


def parse_target(token: str):
    """Parse 'john:3' -> (slug, chapter, audio_num). Also accepts 'John 3'."""
    if ":" in token:
        s, c = token.split(":", 1)
    else:
        parts = token.rsplit(" ", 1)
        s, c = parts[0], parts[1]
    s = slug(s.strip())
    c = int(c.strip())
    if s not in SLUG_TO_BOOK:
        raise ValueError(f"Unknown book: {s}")
    name, sf, total = SLUG_TO_BOOK[s]
    if not (1 <= c <= total):
        raise ValueError(f"{name} only has {total} chapters")
    return s, c, sf + c - 1


def download_audio(audio_num: int) -> Path:
    p = AUDIO_CACHE / f"{audio_num}.mp3"
    if p.exists() and p.stat().st_size > 0:
        return p
    url = f"{AUDIO_BASE}/{audio_num}.mp3"
    print(f"  fetching {url}", file=sys.stderr)
    urllib.request.urlretrieve(url, p)
    return p


def run_align(chapter_json_path: Path, audio_path: Path, out_path: Path,
              align_model, metadata, device: str):
    from align_chapter import (
        assemble_words, build_alignment_text, load_chapter, tokenize_for_align,
    )

    book, chapter, verses = load_chapter(chapter_json_path)
    full_text, verse_offsets, total_tokens = build_alignment_text(book, chapter, verses)

    audio = whisperx.load_audio(str(audio_path))
    audio_duration = len(audio) / 16000.0

    result = whisperx.align(
        [{"text": full_text, "start": 0.0, "end": audio_duration}],
        align_model, metadata, audio, device, return_char_alignments=False,
    )
    word_segments = result.get("word_segments") or []
    expected_tokens = tokenize_for_align(full_text)

    out_words, preamble_end = assemble_words(
        expected_tokens, verse_offsets, word_segments, audio_duration
    )

    out = {
        "book": book, "chapter": chapter,
        "audio_duration": round(audio_duration, 3),
        "preamble_end": round(preamble_end, 3),
        "audio_number": int(audio_path.stem),
        "words": out_words,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, separators=(",", ":")))
    return len(out_words), out["preamble_end"], audio_duration, len(word_segments), total_tokens


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("targets", nargs="*", help="e.g. john:3 genesis:1")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--skip-existing", action="store_true", default=True)
    args = ap.parse_args()

    if args.all:
        targets = list(all_chapters())
    else:
        if not args.targets:
            ap.error("provide targets or --all")
        targets = [parse_target(t) for t in args.targets]

    print(f"Loading alignment model on {args.device}...", file=sys.stderr)
    align_model, metadata = whisperx.load_align_model(language_code="en", device=args.device)

    t0 = time.time()
    done = 0
    skipped = 0
    failed = []
    for s, c, audio_num in targets:
        out_path = ALIGN_DIR / s / f"{c}.json"
        if args.skip_existing and out_path.exists():
            skipped += 1
            continue
        chap_json = STATIC_DIR / s / f"{c}.json"
        if not chap_json.exists():
            print(f"  skip {s} {c}: no source json", file=sys.stderr)
            continue
        print(f"[{done+1}/{len(targets)}] {s} {c} (audio {audio_num})", file=sys.stderr)
        try:
            audio = download_audio(audio_num)
            n_words, p_end, dur, n_segs, n_expected = run_align(
                chap_json, audio, out_path, align_model, metadata, args.device
            )
            print(
                f"  → {n_words} words emitted ({n_segs} aligned segs / {n_expected} expected tokens), "
                f"preamble {p_end:.2f}s, dur {dur:.1f}s",
                file=sys.stderr,
            )
            done += 1
        except Exception as e:
            print(f"  FAILED: {e}", file=sys.stderr)
            failed.append((s, c, str(e)))

    print(f"\nDone: aligned {done}, skipped {skipped}, failed {len(failed)} in {time.time()-t0:.1f}s",
          file=sys.stderr)
    for s, c, e in failed:
        print(f"  FAIL {s} {c}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
