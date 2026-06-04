#!/usr/bin/env python3
"""Run batch_align.py across N parallel workers.

Each worker gets a disjoint slice of the chapter list and runs in its
own subprocess with OMP/MKL threads pinned to 1 — the model itself is
the parallelism unit (one model per process). 6 workers ≈ 75% of an
8-core machine.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from batch_align import BIBLE, slug  # type: ignore

WORKERS = int(os.environ.get("ALIGN_WORKERS", "2"))


def all_targets() -> list[str]:
    out = []
    for name, _sf, ch in BIBLE:
        s = slug(name)
        for c in range(1, ch + 1):
            out.append(f"{s}:{c}")
    return out


def main():
    targets = all_targets()
    print(f"total chapters: {len(targets)}; workers: {WORKERS}", file=sys.stderr)

    # Round-robin partition so work is roughly balanced (Psalms is huge,
    # but each chapter is tiny; spreading by index keeps load even).
    shards: list[list[str]] = [[] for _ in range(WORKERS)]
    for i, t in enumerate(targets):
        shards[i % WORKERS].append(t)

    log_dir = SCRIPT_DIR / "align-logs"
    log_dir.mkdir(exist_ok=True)

    procs = []
    for i, shard in enumerate(shards):
        env = os.environ.copy()
        # Pin BLAS / OpenMP so workers don't fight each other.
        env["OMP_NUM_THREADS"] = "1"
        env["MKL_NUM_THREADS"] = "1"
        env["OPENBLAS_NUM_THREADS"] = "1"
        env["TOKENIZERS_PARALLELISM"] = "false"
        env["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
        log_path = log_dir / f"worker-{i}.log"
        log = open(log_path, "w")
        cmd = [
            "nice", "-n", "19",
            sys.executable,
            str(SCRIPT_DIR / "batch_align.py"),
            *shard,
        ]
        print(f"  worker {i}: {len(shard)} chapters → {log_path}", file=sys.stderr)
        p = subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT)
        procs.append((i, p, log_path))

    start = time.time()
    failed = 0
    for i, p, log_path in procs:
        rc = p.wait()
        elapsed = time.time() - start
        marker = "OK" if rc == 0 else f"FAIL rc={rc}"
        print(f"[{elapsed:6.1f}s] worker {i} {marker} ({log_path})", file=sys.stderr)
        if rc != 0:
            failed += 1

    print(f"done in {time.time() - start:.1f}s, {failed} workers failed", file=sys.stderr)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
