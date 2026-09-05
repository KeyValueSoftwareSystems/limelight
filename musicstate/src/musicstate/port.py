"""The small end conversion: a MusicState dict -> a MAP v0.3 dict.

MusicState is what the pipeline produces (per-level analyzer output). The MAP is
the shipped file. This function is pure — dict in, dict out — so it is trivial to
test against a reference map. It measures nothing; it only reshapes.
"""
from __future__ import annotations

import os

_KINDS = {"build", "drop", "stop", "quiet", "spotlight", "return"}


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
    merged: list[dict] = []
    for sec in secs:
        name = sec.get("label")
        if merged and merged[-1]["name"] == name:
            merged[-1]["to"] = sec["t1"]
        else:
            merged.append({"at": sec["t0"], "to": sec["t1"], "name": name})

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
    events = state.get("events") or []
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
            moments.append({"at": e["t"], "kind": "drop",
                            "confidence": conf, "size": round(conf + 0.2, 3)})
        else:
            moments.append({"at": e["t"], "kind": kind, "confidence": conf})

    # ---- spans: pair each build with the next drop ----
    drops = [e for e in events if e.get("type") == "drop"]
    spans = []
    for e in events:
        if e.get("type") != "build":
            continue
        nxt = next((d for d in drops if d["t"] > e["t"]), None)
        if not nxt:
            continue
        frm, to = e["t"], nxt["t"]
        bars = round((to - frm) / period / 4, 1) if period else None
        spans.append({"kind": "build", "from": frm, "to": to, "rise": "steady",
                      "bars": bars, "how": "derived: musicstate build event to the next drop event"})

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

    return {
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
        "energy": state.get("energy") or [],
        "confidence": confidence,
        "confidence_by_field": cbf,
        "stems": stems,
        "observations": observations,
        "vectors": vectors,
    }
