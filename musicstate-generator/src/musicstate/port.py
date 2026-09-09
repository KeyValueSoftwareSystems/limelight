"""The small end conversion: a MusicState dict -> a MAP v0.3 dict.

MusicState is what the pipeline produces (per-level analyzer output). The MAP is
the shipped file. This function is pure — dict in, dict out — so it is trivial to
test against a reference map. It measures nothing; it only reshapes.
"""
from __future__ import annotations

import math
import os

from .segments import merge_sections

_KINDS = {"build", "drop", "stop", "quiet", "spotlight", "return"}
_NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _melody_to_list(mel):
    """MAP melody notes are lists [start_s, name, midi]; the pyin contour arrives as
    dicts {at, hz, note}. Convert voiced samples (unvoiced hz=None score nothing and
    are dropped) so downstream readers and the scorer can index the pitch. Pure."""
    if not isinstance(mel, dict):
        return mel
    notes = mel.get("notes")
    if not isinstance(notes, list) or not notes or isinstance(notes[0], list):
        return mel                       # absent or already in list form
    out = []
    for n in notes:
        if not isinstance(n, dict):
            continue
        hz, at = n.get("hz"), n.get("at")
        if hz is None or at is None or hz <= 0:
            continue
        midi = int(round(69 + 12 * math.log2(hz / 440.0)))
        name = n.get("note") or f"{_NOTE_NAMES[midi % 12]}{midi // 12 - 1}"
        out.append([round(at, 3), name, midi])
    m2 = dict(mel)
    m2["notes"] = out
    m2["unit"] = "[start_s, name, midi]"
    return m2


def _to_pos(t, phase, period):
    return round((t - phase) / period, 4)


def _annotate_positions(m, phase, period):
    """pos = beats from the grid origin, on every timed entry. Pure (port only)."""
    if not period:
        return
    p = lambda t: _to_pos(t, phase, period)  # noqa: E731
    for c in m.get("chapters") or []:
        c["pos"] = p(c["at"])
    for x in m.get("moments") or []:
        x["pos"] = p(x["at"])
    for s in m.get("spans") or []:
        if "from" in s:
            s["pos_from"] = p(s["from"])
        if "to" in s:
            s["pos_to"] = p(s["to"])
    for e in (m.get("sections") or {}).get("entries") or []:
        e["pos"] = p(e["at"])
        if "to" in e:
            e["pos_to"] = p(e["to"])
    for e in (m.get("accents") or {}).get("events") or []:
        if "at" in e:
            e["pos"] = p(e["at"])
    ch = (m.get("observations") or {}).get("chords") or {}
    for e in ch.get("events") or []:
        if "at" in e:
            e["pos"] = p(e["at"])


def _snap_structure_to_grid(m, phase, period, bar_phase):
    """Pull chapters / section entries / span starts onto the bar grid.

    Sections begin on bar lines in this music, but the boundaries come from a
    segmenter at arbitrary seconds, so after the grid is locked to the kick they no
    longer line up. Snapping them to the nearest bar line is what the winning maps
    do (ev_bars checks exactly this). A boundary that *names* a drop/stop rides to
    that moment's half-bar instead, and moments themselves are already grid-aligned
    by MomentTimingAnalyzer, so they are left alone. Pure — grid math only.
    """
    if not period:
        return
    bar = 4.0 * period
    base = phase + bar_phase * period
    first = phase                       # marks at/before the first beat are exempt
    def bar_line(t):
        return round(base + round((t - base) / bar) * bar, 6)
    drop_stop = [round(x["at"], 6) for x in (m.get("moments") or [])
                 if isinstance(x, dict) and x.get("kind") in ("drop", "stop")]
    def boundary(t):
        if t <= first + 1e-9:
            return round(t, 6)          # the intro anchor (chapter at 0.0) stays put
        for d in drop_stop:
            if abs(d - t) < period * 0.75:
                return d                # a boundary that names a drop rides to its half bar
        return bar_line(t)
    for c in m.get("chapters") or []:
        c["at"] = boundary(c["at"])
    for e in (m.get("sections") or {}).get("entries") or []:
        e["at"] = boundary(e["at"])
        if "to" in e and e["to"] > first:
            e["to"] = bar_line(e["to"])
    for s in m.get("spans") or []:
        if "from" in s and s["from"] > first:
            s["from"] = bar_line(s["from"])
    # build/quiet/spotlight/return moments come from the segmenter at section times;
    # snap them to the half-bar grid. drop/stop are owned by MomentTimingAnalyzer,
    # which measured them against the recording, so those are left exactly as placed.
    half = 2.0 * period
    for x in m.get("moments") or []:
        if isinstance(x, dict) and x.get("kind") not in ("drop", "stop") and x.get("at", 0) > first:
            x["at"] = round(base + round((x["at"] - base) / half) * half, 6)
    # keep chapters strictly increasing (validate.py requires it): a collision after
    # snapping means two boundaries fell on one bar line -- one bar line, one chapter.
    chs = sorted(m.get("chapters") or [], key=lambda c: c["at"])
    seen, uniq = set(), []
    for c in chs:
        key = round(c["at"], 3)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
    m["chapters"] = uniq


def _groove(accent_events):
    """Swing summary from per-hit deviation off the nearest sixteenth (listen/beatpos)."""
    devs, byslot = [], {0: [], 1: [], 2: [], 3: []}
    for e in accent_events or []:
        if "pos" not in e:
            continue
        d = e["pos"] - round(e["pos"] * 4) / 4
        e["off16"] = round(d, 4)
        devs.append(d)
        byslot[int(round(e["pos"] * 4)) % 4].append(d)
    if len(devs) < 20:
        return None
    s = sorted(devs)
    med = s[len(s) // 2]
    spread = s[int(len(s) * 0.84)] - s[int(len(s) * 0.16)]
    return {
        "how": "deviation of each drum hit from the nearest sixteenth, in beats, kept per hit "
               "as off16; a quantised record reads near zero, swing shows as a consistent bias "
               "on the off-slots",
        "median_beats": round(med, 4), "spread_beats": round(spread, 4),
        "by_sixteenth": {str(k): (round(sum(v) / len(v), 4) if v else None)
                         for k, v in byslot.items()},
        "hits": len(devs),
    }


def to_map(state: dict, vec_filename: str | None = None,
           ported_by: str = "musicstate.port") -> dict:
    src = state.get("source", {})
    meta = state.get("meta", {})
    length = float(src.get("duration_s") or meta.get("duration_s") or 0.0)
    beats = state.get("beats") or []
    downbeats = state.get("downbeats") or []
    cbf = state.get("confidence_by_field") or {}
    prov = state.get("provenance", {})

    # ---- grid: reproduce the beat clock from period + phase ----
    bpm = meta.get("tempo_bpm")
    period = round(60.0 / bpm, 5) if bpm else None
    phase = beats[0] if beats else 0.0
    bar_phase = beats.index(downbeats[0]) if (downbeats and downbeats[0] in beats) else 0
    grid = {
        "period": period, "phase": phase, "bpm": bpm, "bar_phase": bar_phase,
        "locked": False, "how": "allin1 beat tracking",
        "note": "beats start at the first tracked beat, not at t=0",
    }

    # ---- chapters + sections: merge consecutive same-label runs ----
    secs = state.get("sections") or []
    merged = merge_sections(secs)

    chapters = [{"at": round(m["at"], 2), "name": m["name"]} for m in merged]

    id_counts: dict[str, int] = {}
    entries = []
    for i, m in enumerate(merged):
        name = m["name"] or "?"
        sid = name[0].upper()
        id_counts[sid] = id_counts.get(sid, 0) + 1
        arc = 1.0 if i == len(merged) - 1 else (round(m["at"] / length, 3) if length else 0.0)
        entries.append({"at": round(m["at"], 2), "to": round(m["to"], 2), "name": name,
                        "id": sid, "repeat": id_counts[sid], "arc": arc})
    sections = {"how": "allin1 labelled segments, consecutive same-label runs merged",
                "entries": entries}

    # ---- moments (only the six kinds); a drop's confidence trails its size ----
    # MomentTimingAnalyzer publishes an authoritative re-timed list; prefer it.
    events = state.get("events_retimed") or state.get("events") or []
    moments = []
    dropped = []
    for e in events:
        kind = e.get("type")
        if kind not in _KINDS:
            dropped.append(kind)
            continue
        conf = e.get("conf", 0.0)
        if kind == "drop":
            # a drop carries how sure we are (confidence) and how big it is (size)
            size = e.get("size", round(conf + 0.2, 3))
            moments.append({"at": e["t"], "kind": "drop", "confidence": conf, "size": size})
        else:
            moments.append({"at": e["t"], "kind": kind, "confidence": conf})

    # thin so no two of a kind sit within a bar (derivation now arrives as events)
    period_for = period or (round(60.0 / bpm, 5) if bpm else 0.5)
    moments.sort(key=lambda m: m["at"])
    thinned: list[dict] = []
    for mo in moments:
        if (thinned and mo["kind"] == thinned[-1]["kind"]
                and abs(mo["at"] - thinned[-1]["at"]) < period_for * 2):
            if mo.get("confidence", 0) > thinned[-1].get("confidence", 0):
                thinned[-1] = mo
            continue
        thinned.append(mo)
    moments = thinned

    # ---- spans: one build->drop per drop, kept non-overlapping ----
    drop_ms = [m for m in moments if m["kind"] == "drop"]
    build_ms = [m for m in moments if m["kind"] == "build"]
    spans = []
    for d in drop_ms:
        cands = [b for b in build_ms if b["at"] < d["at"]]
        if not cands:
            continue
        frm = max(c["at"] for c in cands)
        to = d["at"]
        if spans and frm < spans[-1]["to"]:      # never overlap the previous build
            frm = spans[-1]["to"]
        if to - frm < period_for:
            continue
        bars = round((to - frm) / period_for / 4, 1) if period_for else None
        spans.append({"kind": "build", "from": frm, "to": to, "rise": "steady",
                      "bars": bars, "how": "derived: build moment to the next drop moment"})

    # ---- stems: list-of-dicts -> per-stem arrays + explicit guitar/piano zeros ----
    st = state.get("stems") or {}
    pd = st.get("per_downbeat") or []
    names = st.get("names") or []
    at = [r["t"] for r in pd]
    sources = {nm: [r.get(nm) for r in pd] for nm in names}
    for extra in ("guitar", "piano"):
        sources.setdefault(extra, [0.0] * len(pd))
    stems = {
        "model": st.get("model"), "rate": "per_downbeat", "sources": sources, "at": at,
        "vocal_present_fraction": st.get("vocal_present_fraction"),
        "note": "Four-stem htdemucs mapped onto the six canonical names.",
    } if pd else None

    # ---- observation tier ----
    sem = state.get("semantic") or {}
    frames = state.get("frames") or {}
    bands = frames.get("bands", {})
    r4 = lambda a: [round(float(x), 4) for x in a] if a else a  # noqa: E731
    frames_obs = {
        "how": "librosa, per hop",
        "hop_s": frames.get("hop_s"), "t0": frames.get("t0"), "n": frames.get("n"),
        "rms": r4(frames.get("rms")), "onset": r4(frames.get("onset")),
        "low": r4(bands.get("low")), "mid": r4(bands.get("mid")), "high": r4(bands.get("high")),
        "note": "A continuous stream at about 43 Hz, which nothing else in this format provides. "
                "Beats and moments say when something happens; this says what the sound is doing "
                "between them, split into three bands. It is what lets a reader follow texture "
                "rather than only punctuation.",
    } if frames else None
    keyest = f"{meta.get('key')} {meta.get('mode')}" if meta.get("key") else None
    observations = {
        "semantic": {"how": sem.get("backend"), "mood": sem.get("mood"),
                     "danceability": sem.get("danceability"), "voice": sem.get("voice"),
                     "genre_top": sem.get("genre_top"),
                     "note": "Whole-song judgements, not per-moment. party and danceability are "
                             "the two a lighting recipe can act on directly; the rest are context."}
        if sem.get("status") == "ok" else None,
        "frames": frames_obs,
        "key": {"estimate": keyest, "how": "musicstate", "confidence": cbf.get("key")},
        "bar_phase_decision": state.get("bar_phase_decision"),
        "moment_timing": state.get("moment_timing"),
        # harmony layers: the analyzers write the full block; the port only lifts it
        "chords": state.get("chords"),
        "melody": _melody_to_list(state.get("melody")),
        "notes": state.get("notes"),
    }

    # ---- learned tier ----
    emb = state.get("embedding") or {}
    vectors = None
    if emb.get("status") == "ok":
        vectors = {"model": emb.get("model"), "rate": emb.get("rate"), "rows": emb.get("rows"),
                   "dim": emb.get("dim"), "dtype": emb.get("dtype"),
                   "file": vec_filename or emb.get("file")}

    # ---- confidence: one number is the mean of the per-field ones ----
    confidence = round(sum(cbf.values()) / len(cbf), 3) if cbf else 0.0

    made_by = {
        "how": "model",
        "who": prov.get("tool", "musicstate"),
        "why": "Ported from musicstate. Beats, downbeats and labelled sections come from allin1; "
               "energy and the frame stream from librosa; per-stem presence from htdemucs; "
               "mood and danceability from Essentia; embeddings from MERT.",
        "ported_by": ported_by,
        "analyzers": prov.get("analyzers", []),
        "port_notes": [
            f"{len(secs)} sections merged to {len(merged)}: consecutive blocks with the same "
            "label are one section, not several.",
            "spans derived by pairing each build event with the next drop event.",
            f"moment kinds not in our six were dropped: {', '.join(dropped) if dropped else 'none'}.",
            "guitar and piano are explicit zeros - htdemucs 4-stem does not separate them, and "
            "an absent field would read as 0.5.",
        ],
    }

    out = {
        "map": "0.3",
        "song": {"title": os.path.basename(src.get("path", "")), "artist": "?", "length": length},
        "made_by": made_by,
        "grid": grid,
        "beats": beats,
        "downbeats": downbeats,
        "beats_window": [0.0, length],
        "chapters": chapters,
        "sections": sections,
        "spans": spans,
        "moments": moments,
        "accents": state.get("accents"),
        "energy": state.get("energy") or [],
        "confidence": confidence,
        "confidence_by_field": cbf,
        "stems": stems,
        "observations": observations,
        "vectors": vectors,
    }
    _snap_structure_to_grid(out, phase, period, bar_phase)
    _annotate_positions(out, phase, period)
    groove = _groove((out.get("accents") or {}).get("events") or [])
    if groove:
        out["observations"]["groove"] = groove
    return out
