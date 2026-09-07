"""Orchestration: load audio, run analyzers in order, fold into one MusicState.

Instrumented: every stage is timed and logged, and the per-stage timings are kept
in ``provenance.timing`` so the cost of a build is part of its own record. Graceful
degrade is the contract — an unavailable or failing analyzer is recorded and skipped;
the rest still produce a valid MusicState.
"""
from __future__ import annotations

import datetime as _dt
import logging
import time
from typing import Any

from . import __version__
from .analyzers import (
    AccentsAnalyzer,
    Allin1Analyzer,
    Analyzer,
    ChordsAnalyzer,
    ClapAnalyzer,
    CombinedEmbeddingAnalyzer,
    DspAnalyzer,
    EmbeddingAnalyzer,
    MelodyAnalyzer,
    NoteTranscriptionAnalyzer,
    SemanticAnalyzer,
    StemsAnalyzer,
    StructureAnalyzer,
)
from .audio import Audio, load_audio

log = logging.getLogger("musicstate.pipeline")


def core_analyzers() -> list[Analyzer]:
    """The reliable core — librosa only, no model downloads, runs anywhere."""
    return [DspAnalyzer(), StructureAnalyzer(), AccentsAnalyzer(), ChordsAnalyzer()]


def deep_analyzers() -> list[Analyzer]:
    """The full stack. allin1 supersedes librosa L2; each degrades if unavailable."""
    return [
        DspAnalyzer(),
        StructureAnalyzer(),
        Allin1Analyzer(),
        AccentsAnalyzer(),       # discrete onsets on the (allin1) beat grid
        ChordsAnalyzer(),        # per-bar chords on the (allin1) beat grid
        MelodyAnalyzer(),        # pyin melody contour
        StemsAnalyzer(),
        SemanticAnalyzer(),
        EmbeddingAnalyzer(),
        ClapAnalyzer(),
        CombinedEmbeddingAnalyzer(),
        NoteTranscriptionAnalyzer(),  # polyphonic notes via basic-pitch (onnx)
    ]


def _new_state(audio: Audio) -> dict[str, Any]:
    return {
        "musicstate_version": "0.2",
        "source": {"path": audio.path, "sha1": audio.sha1,
                   "duration_s": round(audio.duration_s, 3), "sample_rate": audio.sample_rate},
        "meta": {"duration_s": round(audio.duration_s, 3), "tempo_bpm": None,
                 "key": None, "mode": None, "time_signature": None},
        "frames": None, "beats": [], "downbeats": [], "sections": [], "energy": [], "events": [],
        "semantic": {"status": "not_computed"}, "embedding": {"status": "not_computed"},
        "confidence_by_field": {},
        "provenance": {
            "tool": f"musicstate {__version__}",
            "built_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
            "analyzers": [], "timing": {},
        },
    }


def _merge(state: dict, patch: dict) -> None:
    for key, value in patch.items():
        if key == "meta_partial":
            state["meta"].update({k: v for k, v in value.items() if v is not None})
        elif key == "events":
            state["events"].extend(value)
        else:
            state[key] = value


def build(path: str, analyzers: list[Analyzer] | None = None,
          ctx_extra: dict[str, Any] | None = None) -> dict[str, Any]:
    started = time.perf_counter()
    log.info("loading %s", path)
    t0 = time.perf_counter()
    audio = load_audio(path)
    load_s = time.perf_counter() - t0

    analyzers = analyzers or core_analyzers()
    state = _new_state(audio)
    timing = state["provenance"]["timing"]
    timing["load"] = round(load_s, 3)
    log.info("loaded %.1fs of audio @ %dHz in %.2fs", audio.duration_s, audio.sample_rate, load_s)

    ctx: dict[str, Any] = {"duration_s": audio.duration_s, "sr": audio.sample_rate, "source_path": path}
    if ctx_extra:
        ctx.update(ctx_extra)

    for analyzer in analyzers:
        record = {"level": analyzer.level, "name": analyzer.name}
        ok, why = analyzer.available()
        if not ok:
            log.warning("skip %s %s — %s", analyzer.level, analyzer.name, why)
            record.update(status="not_available", reason=why)
            state["provenance"]["analyzers"].append(record)
            continue

        t0 = time.perf_counter()
        try:
            result = analyzer.analyze(audio.samples, audio.sample_rate, ctx)
        except Exception as exc:  # noqa: BLE001
            elapsed = time.perf_counter() - t0
            log.error("%s %s FAILED after %.2fs: %r", analyzer.level, analyzer.name, elapsed, exc)
            record.update(status="failed", reason=repr(exc), seconds=round(elapsed, 3))
            timing[f"{analyzer.level}:{analyzer.name}"] = round(elapsed, 3)
            state["provenance"]["analyzers"].append(record)
            continue

        elapsed = time.perf_counter() - t0
        timing[f"{analyzer.level}:{analyzer.name}"] = round(elapsed, 3)
        _merge(state, result.patch)
        state["confidence_by_field"].update(result.confidence)
        ctx.update(result.ctx)
        record.update(status=result.status, seconds=round(elapsed, 3))
        if result.notes:
            record["notes"] = result.notes
        state["provenance"]["analyzers"].append(record)
        log.info("%s %-24s %7.2fs  %s", analyzer.level, analyzer.name, elapsed, result.status)

    state["events"].sort(key=lambda e: e.get("t", 0.0))
    total = time.perf_counter() - started
    timing["total"] = round(total, 3)
    log.info("pipeline complete in %.2fs", total)
    return state


def summarize(state: dict) -> str:
    meta, frames = state["meta"], (state.get("frames") or {})
    lines = [
        f"source     {state['source']['path']}  "
        f"({state['source']['duration_s']}s @ {state['source']['sample_rate']}Hz)",
        f"tempo      {meta.get('tempo_bpm')} bpm   key {meta.get('key')} {meta.get('mode')}   "
        f"{meta.get('time_signature')}",
        f"beats      {len(state['beats'])}   downbeats {len(state['downbeats'])}",
        f"sections   {len(state['sections'])}   events {len(state['events'])}   "
        f"frames {frames.get('n', 0)} @ {frames.get('hop_s')}s",
        f"semantic   {state['semantic'].get('status')}    embedding {state['embedding'].get('status')}",
    ]
    if state.get("stems"):
        stems = state["stems"]
        lines.append(f"stems      {stems.get('model')} {stems.get('names')}  "
                     f"vocal_present={stems.get('vocal_present_fraction')}")
    lines.append("analyzers  " + ", ".join(
        f"{a['level']}:{a.get('status')}" for a in state["provenance"]["analyzers"]))
    return "\n".join(lines)


def timing_report(state: dict) -> str:
    """A stage-by-stage time-usage table: seconds and share of the total."""
    timing = dict(state.get("provenance", {}).get("timing", {}))
    total = timing.pop("total", None) or (sum(timing.values()) or 1.0)
    rows = sorted(timing.items(), key=lambda kv: kv[1], reverse=True)
    width = max((len(k) for k in timing), default=10)
    lines = ["", "time usage", "-" * (width + 22)]
    for stage, seconds in rows:
        pct = 100.0 * seconds / total
        bar = "#" * int(round(pct / 5))
        lines.append(f"{stage:<{width}}  {seconds:8.2f}s  {pct:5.1f}%  {bar}")
    lines.append("-" * (width + 22))
    lines.append(f"{'total':<{width}}  {total:8.2f}s")
    return "\n".join(lines)
