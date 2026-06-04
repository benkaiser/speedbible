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


def _norm(w: str) -> str:
    """Normalize a word for matching expected tokens to wav2vec2 segments."""
    return WORD_RE.findall(w.replace("\u2019", "'").lower())[0] if WORD_RE.search(w.replace("\u2019", "'")) else ""


def assemble_words(expected_tokens, verse_offsets, word_segments, audio_duration):
    """Walk expected tokens; match each to the next word_segment by text.

    Critically we ALWAYS emit one entry per expected verse-token. If wav2vec2
    drops some segments (which happens when the audio is unclear or at chapter
    fades), we leave those tokens unmapped and fill them by linear interpolation
    between adjacent known anchors. We match by the word text rather than by
    position so that a missing segment in the middle doesn't shift every
    subsequent token's timing — it just creates a single hole.

    Returns (out_words, preamble_end).
    """
    def vnum_for(i):
        for vnum, lo, hi in verse_offsets:
            if lo <= i < hi:
                return vnum
        return -1

    # First pass: text-based alignment.
    # For each segment in order, find the earliest unmatched expected token
    # (at or after the current cursor) whose normalized text equals the
    # segment's normalized text. Tokens between the cursor and the match are
    # left as None (gaps to be interpolated). If no match within a small
    # lookahead, the segment is dropped and the cursor stays put.
    timed = [None] * len(expected_tokens)
    norm_expected = [_norm(t) for t in expected_tokens]
    cursor = 0
    LOOKAHEAD = 6  # how far ahead to scan for a text match
    for w in word_segments:
        if "start" not in w or "end" not in w:
            continue
        seg_word = _norm(w.get("word", ""))
        if not seg_word:
            continue
        # Search for matching expected token at cursor..cursor+LOOKAHEAD.
        match = -1
        end_scan = min(cursor + LOOKAHEAD, len(expected_tokens))
        for k in range(cursor, end_scan):
            if timed[k] is None and norm_expected[k] == seg_word:
                match = k
                break
        if match < 0:
            # No nearby text match — drop this segment rather than
            # mis-assigning it. Cursor unchanged.
            continue
        timed[match] = (float(w["start"]), float(w["end"]))
        cursor = match + 1

    # Second pass: fill any None entries by linear interpolation between
    # adjacent known anchors. For tail Nones (no future anchor), extrapolate
    # toward audio_duration.
    n = len(expected_tokens)
    last_known_end = 0.0
    last_known_idx = -1
    for i in range(n):
        if timed[i] is not None:
            last_known_end = timed[i][1]
            last_known_idx = i

    # Forward-fill missing entries using neighboring known anchors.
    i = 0
    while i < n:
        if timed[i] is not None:
            i += 1
            continue
        # Find next known after i.
        j = i
        while j < n and timed[j] is None:
            j += 1
        # Anchor before: last known at i-1 (or audio start).
        prev_end = timed[i - 1][1] if i > 0 and timed[i - 1] is not None else 0.0
        if j < n:
            next_start = timed[j][0]
        else:
            # No future anchor: extrapolate toward audio_duration.
            next_start = max(prev_end + 0.05, audio_duration - 0.05)
        # Distribute (j - i) tokens evenly in [prev_end, next_start].
        gap = max(next_start - prev_end, 0.04 * (j - i))
        step = gap / max(j - i, 1)
        for k in range(j - i):
            s = prev_end + step * k
            e = prev_end + step * (k + 1) - 0.005
            timed[i + k] = (round(s, 3), round(e, 3))
        i = j

    # Third pass: emit verse-only output (skip preamble verse 0).
    out_words = []
    preamble_end = None
    for ti, tok in enumerate(expected_tokens):
        vnum = vnum_for(ti)
        if vnum < 1:
            continue
        s, e = timed[ti]
        if preamble_end is None:
            preamble_end = float(s)
        out_words.append({"w": tok, "s": round(float(s), 3), "e": round(float(e), 3), "v": vnum})

    return out_words, preamble_end if preamble_end is not None else 0.0


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
    audio_duration = len(audio) / 16000.0

    segments = [{"text": full_text, "start": 0.0, "end": audio_duration}]

    print(f"  loading align model ({args.device})...", file=sys.stderr)
    align_model, metadata = whisperx.load_align_model(language_code="en", device=args.device)

    print(f"  aligning {audio_duration:.1f}s...", file=sys.stderr)
    result = whisperx.align(
        segments, align_model, metadata, audio, args.device,
        return_char_alignments=False,
    )

    word_segments = result.get("word_segments") or []
    if not word_segments:
        sys.exit("No word segments produced")

    expected_tokens = tokenize_for_align(full_text)
    out_words, preamble_end = assemble_words(
        expected_tokens, verse_offsets, word_segments, audio_duration
    )

    out = {
        "book": book,
        "chapter": chapter,
        "audio_duration": round(audio_duration, 3),
        "preamble_end": round(preamble_end, 3),
        "words": out_words,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, separators=(",", ":")))
    print(
        f"  wrote {out_path} ({len(out_words)} words, preamble ends at {preamble_end:.2f}s, "
        f"got {len(word_segments)} aligned segments)",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
