#!/usr/bin/env python3
"""Force-align BSB audio with verse text using WhisperX.

Inputs:
  --chapter-json: path to a BSB chapter JSON (the bible-api shape we already generate)
  --audio:        path to the mp3 for that chapter
  --book-num:     chapter index 1..1189 (used in output metadata)
  --out:          output JSON path

Output JSON:
{
  "book": "John",
  "chapter": 3,
  "audio_duration": 247.83,
  "preamble_end": 2.41,
  "words": [
    {"w": "In", "s": 2.50, "e": 2.62, "v": 1},
    ...
  ]
}

The audio always starts with "<Book name> <chapter number>" before the verses.
We prepend that to the alignment text so the model can lock onto it, then
record the first verse word's start time as `preamble_end` so the player
can seek there.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import whisperx


def load_chapter(json_path: Path):
    data = json.loads(json_path.read_text())
    book = data["verses"][0]["book_name"] if data["verses"] else None
    chapter = data["verses"][0]["chapter"] if data["verses"] else None
    return book, chapter, data["verses"]


WORD_RE = re.compile(r"[A-Za-z0-9'\u2019\-]+")


def tokenize_for_align(s: str) -> list[str]:
    """Split into words the way wav2vec2 alignment will see them."""
    # Strip footnote markers and weird punctuation; alignment only cares about word sequence.
    s = s.replace("\u2019", "'")
    return WORD_RE.findall(s)


def build_alignment_text(book: str, chapter: int, verses: list[dict]):
    """Returns (full_text, verse_token_offsets).

    `verse_token_offsets` is a list of (verse_num, token_count) so we can
    label each aligned word with its verse number.
    The preamble ("<book> <chapter>") is verse 0.
    """
    preamble = f"{book} {chapter}"
    parts = [(0, preamble)]
    for v in verses:
        parts.append((v["verse"], v["text"].strip()))

    full_text = " ".join(p[1] for p in parts)
    verse_offsets = []
    cursor = 0
    for vnum, text in parts:
        toks = tokenize_for_align(text)
        verse_offsets.append((vnum, cursor, cursor + len(toks)))
        cursor += len(toks)
    return full_text, verse_offsets, cursor


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chapter-json", required=True)
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    chapter_json = Path(args.chapter_json)
    audio_path = Path(args.audio)
    out_path = Path(args.out)

    book, chapter, verses = load_chapter(chapter_json)
    if not verses:
        sys.exit("Empty verses array")

    full_text, verse_offsets, total_tokens = build_alignment_text(book, chapter, verses)
    print(f"[{book} {chapter}] {len(verses)} verses, {total_tokens} word tokens", file=sys.stderr)

    audio = whisperx.load_audio(str(audio_path))
    audio_duration = len(audio) / 16000.0  # whisperx resamples to 16k

    # Whisperx align takes a list of segments. We feed one segment for the full chapter.
    # The wav2vec2 CTC alignment will distribute words across the [0, duration] window.
    segments = [{"text": full_text, "start": 0.0, "end": audio_duration}]

    print(f"  loading align model ({args.device})...", file=sys.stderr)
    align_model, metadata = whisperx.load_align_model(language_code="en", device=args.device)

    print(f"  aligning {audio_duration:.1f}s...", file=sys.stderr)
    result = whisperx.align(
        segments,
        align_model,
        metadata,
        audio,
        args.device,
        return_char_alignments=False,
    )

    word_segments = result.get("word_segments") or []
    if not word_segments:
        sys.exit("No word segments produced")

    print(f"  got {len(word_segments)} aligned words", file=sys.stderr)

    # Tag each aligned word with its verse via the offsets we captured.
    # We assume word_segments come back in order, one per token in full_text.
    # Length may differ slightly if wav2vec2 dropped/merged tokens; we walk forward
    # using the original tokens as ground truth and skip alignment items that don't
    # match by case-insensitive word.
    expected_tokens = tokenize_for_align(full_text)

    def vnum_for_token_idx(i: int) -> int:
        for vnum, lo, hi in verse_offsets:
            if lo <= i < hi:
                return vnum
        return -1

    out_words = []
    preamble_end = None
    align_idx = 0
    for ti, tok in enumerate(expected_tokens):
        vnum = vnum_for_token_idx(ti)
        if align_idx >= len(word_segments):
            break
        w = word_segments[align_idx]
        # Some words have no timing if wav2vec2 couldn't resolve them.
        if "start" not in w or "end" not in w:
            align_idx += 1
            continue
        if vnum >= 1:
            if preamble_end is None:
                preamble_end = float(w["start"])
            out_words.append(
                {
                    "w": tok,
                    "s": round(float(w["start"]), 3),
                    "e": round(float(w["end"]), 3),
                    "v": vnum,
                }
            )
        align_idx += 1

    if preamble_end is None:
        preamble_end = 0.0

    out = {
        "book": book,
        "chapter": chapter,
        "audio_duration": round(audio_duration, 3),
        "preamble_end": round(preamble_end, 3),
        "words": out_words,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, separators=(",", ":")))
    print(f"  wrote {out_path} ({len(out_words)} words, preamble ends at {preamble_end:.2f}s)", file=sys.stderr)


if __name__ == "__main__":
    main()
