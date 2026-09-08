"""Command-line interface: audio → MAP v0.3.

    musicstate build song.mp3 -o song.map.json     # full stack
    musicstate build song.mp3 --core               # librosa only, no heavy models
    musicstate build song.mp3 -v                    # verbose (per-analyzer debug logs)
    musicstate click --bpm 120 --secs 16 -o click.wav
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

from .config import pipeline_maps_dir
from .pipeline import build, core_analyzers, deep_analyzers, summarize, timing_report
from .port import to_map


def _next_versioned_path(base_dir, slug: str) -> Path:
    """Next vN.map.json under <base_dir>/<slug>/ — one past the highest N present."""
    song_dir = Path(base_dir) / slug
    highest = 0
    if song_dir.is_dir():
        for f in song_dir.glob("v*.map.json"):
            stem = f.name[1:-len(".map.json")]   # 'v12.map.json' -> '12'
            if stem.isdigit():
                highest = max(highest, int(stem))
    return song_dir / f"v{highest + 1}.map.json"


def _choose_out(out_arg, versioned: bool, slug: str, base_dir) -> tuple[str, bool]:
    """Resolve the output path. Returns (path, versioned_ignored).

    An explicit -o always wins; --versioned is then ignored (reported to the caller).
    """
    if out_arg:
        return out_arg, bool(versioned)
    if versioned:
        return str(_next_versioned_path(base_dir, slug)), False
    return f"{slug}.map.json", False


def setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )


def _cmd_build(args) -> int:
    log = logging.getLogger("musicstate")
    out, versioned_ignored = _choose_out(args.out, args.versioned, _stem(args.audio), pipeline_maps_dir())
    if versioned_ignored:
        log.warning("-o given, so --versioned is ignored (writing to %s)", out)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    map_stem = out[:-9] if out.endswith(".map.json") else out.rsplit(".", 1)[0]
    vec_name = _basename(map_stem) + ".vec.f16"

    analyzers = core_analyzers() if args.core else deep_analyzers()
    log.info("building map with the %s analyzer set", "core" if args.core else "deep")

    started = time.perf_counter()
    state = build(args.audio, analyzers=analyzers, ctx_extra={"out_stem": map_stem})
    mp = to_map(state, vec_filename=vec_name)
    with open(out, "w") as fh:
        json.dump(mp, fh, indent=2)
    wall = time.perf_counter() - started

    print(summarize(state), file=sys.stderr)
    print(timing_report(state), file=sys.stderr)
    print(f"\nwrote {out}  (map v{mp['map']}, {len(mp['beats'])} beats, "
          f"{len(mp['chapters'])} chapters, {len(mp['moments'])} moments, conf {mp['confidence']})")
    print(f"total wall time: {wall:.2f}s", file=sys.stderr)
    return 0


def _cmd_click(args) -> int:
    from .tools.click_track import write_click
    write_click(args.out, bpm=args.bpm, seconds=args.secs)
    print(f"wrote {args.out}  ({args.bpm} bpm, {args.secs}s)")
    return 0


def _stem(path: str) -> str:
    import os
    return os.path.splitext(os.path.basename(path))[0]


def _basename(path: str) -> str:
    import os
    return os.path.basename(path)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="musicstate", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("-v", "--verbose", action="store_true", help="debug-level logs")
    sub = parser.add_subparsers(dest="command", required=True)

    build_p = sub.add_parser("build", help="audio file → MAP v0.3 JSON")
    build_p.add_argument("audio", help="audio file (mp3/wav/flac/…)")
    build_p.add_argument("-o", "--out", help="output map path (default <name>.map.json)")
    build_p.add_argument("--versioned", action="store_true",
                         help="write into maps/generator-pipeline/<name>/vN.map.json, "
                              "auto-incrementing N (ignored if -o is given)")
    build_p.add_argument("--core", action="store_true",
                         help="reliable core only (librosa); skip allin1/Demucs/Essentia/MERT")
    build_p.set_defaults(func=_cmd_build)

    click_p = sub.add_parser("click", help="synthesize a known-BPM click track")
    click_p.add_argument("--bpm", type=float, default=120.0)
    click_p.add_argument("--secs", type=float, default=16.0)
    click_p.add_argument("-o", "--out", default="click.wav")
    click_p.set_defaults(func=_cmd_click)

    args = parser.parse_args(argv)
    setup_logging(args.verbose)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
