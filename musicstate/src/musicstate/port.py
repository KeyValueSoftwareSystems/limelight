"""The small end conversion: a MusicState dict -> a MAP v0.3 dict.

MusicState is what the pipeline produces (per-level analyzer output). The MAP is
the shipped file. This function is pure — dict in, dict out — so it is trivial to
test against a reference map. It measures nothing; it only reshapes.
"""
from __future__ import annotations

import os

_KINDS = {"build", "drop", "stop", "quiet", "spotlight", "return"}

# allin1's section vocabulary, sorted by what a lighting show does with it
_DROP_LABELS = {"chorus", "drop", "hook", "refrain", "inst", "instrumental", "solo"}
_QUIET_LABELS = {"break", "breakdown", "bridge", "intro", "outro", "quiet", "start", "end", "ambient"}


def _mean_energy(energy, t0, t1):
    vals = [v for (tt, v) in energy if t0 <= tt < t1]
    if vals:
        return sum(vals) / len(vals)
    # fall back to the last sample at or before the midpoint
    mid, last = (t0 + t1) / 2.0, (energy[0][1] if energy else 0.5)
    for tt, vv in energy:
        if tt <= mid:
            last = vv
        else:
            break
    return last


def _snap_down(t, downbeats):
    return min(downbeats, key=lambda d: abs(d - t)) if downbeats else t


def _derive_moments(merged, energy, downbeats, period, length):
    """drop/build/quiet moments from chapter energy + labels.

    The section-delta heuristic in the structure analyzer misses tracks whose
    energy does not step hard at a boundary (The Nights produced zero). Reading the
    chapter labels allin1 already gives us, plus the energy of each chapter, puts a
    drop on every chorus and a quiet on every break — which is what makes a show
    escalate instead of sitting flat.
    """
    # needs a real, whole-song energy curve to read chapter dynamics from; a handful
    # of samples cannot say which section is loud, so derive nothing and leave the
    # explicit analyzer events to stand on their own.
    if not merged or len(energy) < 8:
        return []
    for m in merged:
        m["_e"] = _mean_energy(energy, m["at"], m["to"])
    es = sorted(m["_e"] for m in merged)
    lo, hi = es[len(es) // 4], es[max(0, 3 * len(es) // 4)]
    span = max(1e-3, hi - lo)
    bar = (period or 0.5) * 4
    out = []
    for i, m in enumerate(merged):
        name = (m["name"] or "").lower()
        e = m["_e"]
        rise = e - (merged[i - 1]["_e"] if i > 0 else e)
        is_drop = (name in _DROP_LABELS and e >= lo + 0.35 * span) or e >= lo + 0.65 * span
        is_quiet = (name in _QUIET_LABELS and e <= lo + 0.4 * span) or e <= lo + 0.15 * span
        if is_drop:
            at = _snap_down(m["at"], downbeats)
            out.append({"at": at, "kind": "drop",
                        "confidence": round(min(1.0, 0.5 + max(0.0, rise) * 2), 3),
                        "size": round(min(1.0, 0.6 + (e - lo) / span * 0.4), 3)})
            b_at = _snap_down(max(0.0, at - 4 * bar), downbeats)
            if b_at < at - bar:
                out.append({"at": b_at, "kind": "build", "confidence": 0.5})
        elif is_quiet and i > 0:
            at = _snap_down(m["at"], downbeats)
            out.append({"at": at, "kind": "quiet",
                        "confidence": round(min(1.0, 0.5 + (lo - e) + 0.2), 3)})
    return out


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

    # add label+energy derived moments, then thin so no two of a kind sit within a bar
    period_for = period or (round(60.0 / bpm, 5) if bpm else 0.5)
    moments.extend(_derive_moments(merged, state.get("energy") or [], downbeats, period_for, length))
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
        # harmony layers: the analyzers write the full block; the port only lifts it
        "chords": state.get("chords"),
        "melody": state.get("melody"),
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
        "accents": state.get("accents"),
        "energy": state.get("energy") or [],
        "confidence": confidence,
        "confidence_by_field": cbf,
        "stems": stems,
        "observations": observations,
        "vectors": vectors,
    }
