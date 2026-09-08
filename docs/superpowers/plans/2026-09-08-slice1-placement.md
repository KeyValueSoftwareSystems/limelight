# Slice 1 — Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pipeline place drops/stops where the record puts them — on the bar or half-bar at the measured loudness step, on a kick-derived bar-line phase — and give every timed entry a musical `pos`, by porting `listen/`'s `moments.py`, `barphase.py`, and `beatpos.py` into the pipeline's conventions.

**Architecture:** Three new L2 analyzers (`MomentDeriveAnalyzer`, `BarPhaseAnalyzer`, `MomentTimingAnalyzer`) plus a pure `pos`/groove step in `port.py`. Moment *derivation* leaves `port` (was `_derive_moments`/`_snap_down`) and becomes an analyzer; re-timing measures audio in `MomentTimingAnalyzer` and publishes an authoritative `events_retimed` list that `port` prefers; `port` stays pure and only reshapes.

**Tech Stack:** Python 3, librosa, numpy, pytest, jsonschema. Env: `limelight-ms` conda env.

**Spec:** `docs/superpowers/specs/2026-09-08-listen-pipeline-parity-design.md`

## Global Constraints

- **Analyzer contract** (`analyzers/base.py`): subclass `Analyzer`, set `name` + `level` (`"L2"`), optionally override `available()`, return `AnalyzerResult(status, patch, confidence, ctx, notes)` from `analyze(audio, sample_rate, ctx)`. `status` ∈ `{"ok","not_computed","failed"}`.
- **`port.py` is pure** — dict in, dict out, measures nothing. Enrichment lands as append-only `observations.*`. The six-kind `moments` door (`build/drop/stop/quiet/spotlight/return`) is sacred.
- **`config.py` holds every constant.** No tuning number inline in an analyzer.
- **One writer per fact.** `merge_sections` lives in exactly one module; `events_retimed` is written only by `MomentTimingAnalyzer`.
- **Never fill an unmeasured field.** No drops/stops → clean no-op (`status="not_computed"`); no low-band evidence → keep the incoming phase.
- **`_merge` semantics** (`pipeline.py`): every patch key **replaces** state, except `events` (extended) and `meta_partial` (non-null update). Analyzers see only `ctx`; publish cross-analyzer data through `AnalyzerResult.ctx`.
- **Verify** each task: `conda activate limelight-ms && cd musicstate-generator && PYTHONPATH=src python -m pytest -q`.
- **Commit** after every green task. Branch: `listen-pipeline-parity`.

## File structure

- Create `musicstate-generator/src/musicstate/segments.py` — `merge_sections()` (one writer for the section-merge fact; used by `port` and `MomentDeriveAnalyzer`).
- Create `analyzers/moment_derive.py` — `MomentDeriveAnalyzer` (candidate drop/build/quiet events from labels+energy; no snapping).
- Create `analyzers/bar_phase.py` — `BarPhaseAnalyzer` (kick-band downbeat phase; allin1 as strong prior).
- Create `analyzers/moment_timing.py` — `MomentTimingAnalyzer` (re-time drop/stop to the sustained loudness step, half-bar prior).
- Modify `port.py` — remove `_derive_moments`/`_snap_down`; use `merge_sections`; prefer `events_retimed`; lift `bar_phase_decision`/`moment_timing` into `observations`; add `pos` + `observations.groove`.
- Modify `analyzers/structure.py` — publish `sections`, `energy`, `tempo_bpm`, `events` in `ctx`.
- Modify `analyzers/allin1.py` — mirror those `ctx` additions where it writes them.
- Modify `analyzers/__init__.py` + `pipeline.py` — export and register the three analyzers in dependency order.
- Modify `schema/musicstate.schema.json` — declare the new optional state keys.
- Tests: `tests/test_port.py` (update), `tests/test_moment_derive.py`, `tests/test_bar_phase.py`, `tests/test_moment_timing.py`, `tests/test_pipeline.py` (extend).

---

### Task 1: Pure `pos` + `observations.groove` in `port.py`

Ports `listen/beatpos.py::add`. Every timed entry in the MAP gains `pos = (t - phase) / period`; drum accents gain `off16`; `observations.groove` summarizes swing. Pure — no audio.

**Files:**
- Modify: `musicstate-generator/src/musicstate/port.py`
- Test: `musicstate-generator/tests/test_port.py`

**Interfaces:**
- Produces: `_to_pos(t: float, phase: float, period: float) -> float`; `_annotate_positions(m: dict, phase: float, period: float) -> None` (mutates the built MAP in place); `_groove(accent_events: list[dict]) -> dict | None`. `to_map` calls them before returning.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_port.py`:

```python
def test_pos_added_to_timed_entries():
    m = _m()
    # period 0.5, phase 0.5 (first beat). chapter "chorus" at 5.0 -> pos (5.0-0.5)/0.5 = 9.0
    ch = next(c for c in m["chapters"] if c["name"] == "chorus")
    assert ch["pos"] == 9.0
    drop = next(x for x in m["moments"] if x["kind"] == "drop")
    assert drop["pos"] == round((drop["at"] - 0.5) / 0.5, 4)
    assert m["spans"][0]["pos_from"] == round((m["spans"][0]["from"] - 0.5) / 0.5, 4)


def test_groove_from_accents():
    from musicstate.port import to_map
    # 24 accents: 12 exactly on sixteenths (off16 ~ 0), 12 biased +0.05 beats
    evs = []
    for i in range(12):
        evs.append({"at": 0.5 + i * 0.5, "strength": 0.6})            # on the beat
        evs.append({"at": 0.5 + i * 0.5 + 0.125 + 0.025, "strength": 0.4})  # a hair late
    state = {**STATE, "accents": {"rate": "onset", "events": evs}}
    obs = to_map(state)["observations"]
    assert obs["groove"] is not None
    assert obs["groove"]["hits"] == 24
    assert "by_sixteenth" in obs["groove"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python -m pytest tests/test_port.py::test_pos_added_to_timed_entries -v`
Expected: FAIL with `KeyError: 'pos'`.

- [ ] **Step 3: Write minimal implementation**

In `port.py`, add near the top helpers (after `_KINDS`):

```python
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
    acc = (m.get("accents") or {}).get("events") or []
    for e in acc:
        if "at" in e:
            e["pos"] = p(e["at"])
    ch = (m.get("observations") or {}).get("chords") or {}
    for e in ch.get("events") or []:
        if "at" in e:
            e["pos"] = p(e["at"])


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
```

Then, in `to_map`, just before the final `return {...}`, build the map into a variable and annotate it. Change the tail from `return { ... }` to:

```python
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
    _annotate_positions(out, phase, period)
    groove = _groove((out.get("accents") or {}).get("events") or [])
    if groove:
        out["observations"]["groove"] = groove
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=src python -m pytest tests/test_port.py -v`
Expected: PASS (all existing + the two new tests).

- [ ] **Step 5: Commit**

```bash
git add src/musicstate/port.py tests/test_port.py
git commit -m "port: add pure pos + observations.groove (ports listen/beatpos)"
```

---

### Task 2: Relocate moment derivation into `MomentDeriveAnalyzer`

Extract the section merge to `segments.py`; move `port._derive_moments`/`_snap_down` into a new analyzer that emits **unsnapped candidate events**; `port` stops deriving/snapping and reshapes what it is given.

**Files:**
- Create: `src/musicstate/segments.py`
- Create: `src/musicstate/analyzers/moment_derive.py`
- Modify: `src/musicstate/port.py`, `src/musicstate/analyzers/structure.py`, `src/musicstate/analyzers/__init__.py`, `src/musicstate/pipeline.py`
- Test: `tests/test_moment_derive.py`, `tests/test_port.py`

**Interfaces:**
- Produces: `segments.merge_sections(sections: list[dict]) -> list[dict]` returning `[{"at","to","name"}]`. `MomentDeriveAnalyzer` (`name="moment-derive"`, `level="L2"`) reads `ctx["sections"]`, `ctx["energy"]`, `ctx["tempo_bpm"]`; emits `patch={"events": [...]}` (each `{"t","type","conf"[,"size"]}`) and `ctx={"events": cumulative}`.
- Consumes (from Task-2 structure change): `ctx["sections"]`, `ctx["energy"]`, `ctx["tempo_bpm"]`, `ctx["events"]`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_moment_derive.py`:

```python
from musicstate.analyzers.moment_derive import MomentDeriveAnalyzer
from musicstate.segments import merge_sections


def test_merge_sections_collapses_runs():
    secs = [{"t0": 0, "t1": 5, "label": "intro"},
            {"t0": 5, "t1": 10, "label": "chorus"},
            {"t0": 10, "t1": 15, "label": "chorus"}]
    assert [m["name"] for m in merge_sections(secs)] == ["intro", "chorus"]


def test_derive_emits_unsnapped_drop_on_loud_chorus():
    ctx = {
        "sections": [{"t0": 0.0, "t1": 8.0, "label": "intro", "energy": 0.2, "conf": 0.5},
                     {"t0": 8.3, "t1": 16.0, "label": "chorus", "energy": 0.9, "conf": 0.5},
                     {"t0": 16.0, "t1": 24.0, "label": "break", "energy": 0.1, "conf": 0.5}],
        "energy": [[t, e] for t, e in [(0, .2), (2, .2), (4, .2), (6, .2),
                                       (8.3, .9), (12, .9), (16, .1), (20, .1)]],
        "tempo_bpm": 120.0,
    }
    res = MomentDeriveAnalyzer().analyze(None, 22050, ctx)
    drops = [e for e in res.patch["events"] if e["type"] == "drop"]
    assert len(drops) == 1
    assert drops[0]["t"] == 8.3            # unsnapped: the measured chapter start
    quiets = [e for e in res.patch["events"] if e["type"] == "quiet"]
    assert quiets and quiets[0]["t"] == 16.0


def test_derive_no_energy_is_not_computed():
    res = MomentDeriveAnalyzer().analyze(None, 22050, {"sections": [], "energy": [], "tempo_bpm": 120})
    assert res.status == "not_computed"
    assert res.patch.get("events", []) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python -m pytest tests/test_moment_derive.py -v`
Expected: FAIL with `ModuleNotFoundError: musicstate.segments`.

- [ ] **Step 3: Write minimal implementation**

Create `src/musicstate/segments.py`:

```python
"""One writer for the section-merge fact: consecutive same-label runs become one."""
from __future__ import annotations


def merge_sections(sections):
    merged = []
    for sec in sections or []:
        name = sec.get("label")
        if merged and merged[-1]["name"] == name:
            merged[-1]["to"] = sec["t1"]
        else:
            merged.append({"at": sec["t0"], "to": sec["t1"], "name": name})
    return merged
```

Create `src/musicstate/analyzers/moment_derive.py`:

```python
"""L2 — candidate drop/build/quiet events from chapter labels + energy.

Relocated out of port._derive_moments (2026-09-08) so port measures nothing about
moments. Emits candidates at the *measured* chapter boundary — unsnapped — because
MomentTimingAnalyzer re-times drops/stops to the loudness step afterwards.
"""
from __future__ import annotations

from ..config import DROP_LABELS, QUIET_LABELS
from ..segments import merge_sections
from .base import Analyzer, AnalyzerResult


def _mean_energy(energy, t0, t1):
    vals = [v for (tt, v) in energy if t0 <= tt < t1]
    if vals:
        return sum(vals) / len(vals)
    mid, last = (t0 + t1) / 2.0, (energy[0][1] if energy else 0.5)
    for tt, vv in energy:
        if tt <= mid:
            last = vv
        else:
            break
    return last


class MomentDeriveAnalyzer(Analyzer):
    name = "moment-derive"
    level = "L2"

    def analyze(self, audio, sample_rate, ctx):
        sections = ctx.get("sections") or []
        energy = ctx.get("energy") or []
        merged = merge_sections(sections)
        # a handful of energy samples cannot say which section is loud (rule 2)
        if not merged or len(energy) < 8:
            return AnalyzerResult(status="not_computed", patch={"events": []},
                                  notes="no sections or too little energy")
        for m in merged:
            m["_e"] = _mean_energy(energy, m["at"], m["to"])
        es = sorted(m["_e"] for m in merged)
        lo, hi = es[len(es) // 4], es[max(0, 3 * len(es) // 4)]
        span = max(1e-3, hi - lo)
        out = []
        for i, m in enumerate(merged):
            name = (m["name"] or "").lower()
            e = m["_e"]
            rise = e - (merged[i - 1]["_e"] if i > 0 else e)
            is_drop = (name in DROP_LABELS and e >= lo + 0.35 * span) or e >= lo + 0.65 * span
            is_quiet = (name in QUIET_LABELS and e <= lo + 0.4 * span) or e <= lo + 0.15 * span
            if is_drop:
                out.append({"t": round(m["at"], 4), "type": "drop",
                            "conf": round(min(1.0, 0.5 + max(0.0, rise) * 2), 3),
                            "size": round(min(1.0, 0.6 + (e - lo) / span * 0.4), 3)})
            elif is_quiet and i > 0:
                out.append({"t": round(m["at"], 4), "type": "quiet",
                            "conf": round(min(1.0, 0.5 + (lo - e) + 0.2), 3)})
        cumulative = list(ctx.get("events") or []) + out
        return AnalyzerResult(status="ok", patch={"events": out},
                              ctx={"events": cumulative},
                              notes=f"{len(out)} candidate moments")
```

In `config.py`, add the label sets (moved from `port.py`, one writer):

```python
# --- moment derivation (allin1 label vocabulary, grouped by what a show does) ---
DROP_LABELS = {"chorus", "drop", "hook", "refrain", "inst", "instrumental", "solo"}
QUIET_LABELS = {"break", "breakdown", "bridge", "intro", "outro", "quiet", "start", "end", "ambient"}
```

In `port.py`: delete `_snap_down`, `_derive_moments`, and the module-level `_DROP_LABELS`/`_QUIET_LABELS`. Replace the chapter-merge block with `merge_sections`, and delete the `moments.extend(_derive_moments(...))` line (derivation now arrives as events). Concretely:

```python
# at top of port.py
from .segments import merge_sections
```

```python
    # ---- chapters + sections: merge consecutive same-label runs ----
    secs = state.get("sections") or []
    merged = merge_sections(secs)
```

```python
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
            size = e.get("size", round(conf + 0.2, 3))
            moments.append({"at": e["t"], "kind": "drop", "confidence": conf, "size": size})
        else:
            moments.append({"at": e["t"], "kind": kind, "confidence": conf})

    # thin so no two of a kind sit within a bar (derivation now arrives as events)
    period_for = period or (round(60.0 / bpm, 5) if bpm else 0.5)
    moments.sort(key=lambda m: m["at"])
    thinned = []
    for mo in moments:
        if (thinned and mo["kind"] == thinned[-1]["kind"]
                and abs(mo["at"] - thinned[-1]["at"]) < period_for * 2):
            if mo.get("confidence", 0) > thinned[-1].get("confidence", 0):
                thinned[-1] = mo
            continue
        thinned.append(mo)
    moments = thinned
```

In `structure.py`, extend the returned `ctx` so `MomentDeriveAnalyzer` can read sections/energy/tempo:

```python
        return AnalyzerResult(
            status="ok",
            patch=patch,
            confidence=conf,
            ctx={"beats": patch["beats"], "downbeats": patch["downbeats"],
                 "sections": patch["sections"], "energy": patch["energy"],
                 "tempo_bpm": patch["meta_partial"]["tempo_bpm"],
                 "events": patch["events"]},
            notes="; ".join(notes),
        )
```

Register in `analyzers/__init__.py` (add import + `__all__` entry) and `pipeline.py` (`core_analyzers` and `deep_analyzers`): place `MomentDeriveAnalyzer()` **after** `StructureAnalyzer()` (and, in deep, after `Allin1Analyzer()`).

```python
# analyzers/__init__.py
from .moment_derive import MomentDeriveAnalyzer
# ...add "MomentDeriveAnalyzer" to __all__
```

```python
# pipeline.py core_analyzers()
return [DspAnalyzer(), StructureAnalyzer(), MomentDeriveAnalyzer(), AccentsAnalyzer(), ChordsAnalyzer()]
```

Update `tests/test_port.py::test_moments_six_kinds_and_drop_size`: the STATE `events` already include a drop with `conf 0.7`; with derivation gone from port, the derived `chorus` drop no longer appears, so assert on the explicit events only:

```python
def test_moments_six_kinds_and_drop_size():
    m = _m()
    kinds = [x["kind"] for x in m["moments"]]
    assert kinds == ["build", "drop", "quiet"]  # explicit events only; 'wobble' dropped
    drop = next(x for x in m["moments"] if x["kind"] == "drop")
    assert drop["confidence"] == 0.7 and drop["size"] == 0.9  # size = conf + 0.2
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=src python -m pytest tests/test_moment_derive.py tests/test_port.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/musicstate/segments.py src/musicstate/analyzers/moment_derive.py \
        src/musicstate/config.py src/musicstate/port.py src/musicstate/analyzers/structure.py \
        src/musicstate/analyzers/__init__.py src/musicstate/pipeline.py \
        tests/test_moment_derive.py tests/test_port.py
git commit -m "pipeline: relocate moment derivation into MomentDeriveAnalyzer; port reshapes only"
```

---

### Task 3: `BarPhaseAnalyzer` — kick-band downbeat phase

Ports `listen/barphase.py`. Chooses the 4/4 phase whose bar-lines carry the most **low-band (kick) energy**, treating allin1's downbeats as a strong prior. Writes `bar_phase_decision`; adjusts `downbeats`.

**Files:**
- Create: `src/musicstate/analyzers/bar_phase.py`
- Modify: `src/musicstate/config.py`, `port.py` (lift `bar_phase_decision`), `analyzers/__init__.py`, `pipeline.py`
- Test: `tests/test_bar_phase.py`, `tests/test_port.py`

**Interfaces:**
- Consumes: `audio`, `ctx["beats"]`, `ctx["downbeats"]`, `ctx.get("from_allin1", False)`.
- Produces: `BarPhaseAnalyzer` (`name="bar-phase"`, `level="L2"`), `patch={"downbeats": [...], "bar_phase_decision": {...}}`, `ctx={"downbeats": [...]}`. Helper `_low_energy_per_beat(audio, sr, beats, hop, fmax) -> np.ndarray`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_bar_phase.py`:

```python
import numpy as np
from musicstate.analyzers.bar_phase import BarPhaseAnalyzer, _low_energy_per_beat


def _kick_track(sr=22050, bpm=120, bars=8, kick_phase=0):
    period = 60.0 / bpm
    n = int(period * 4 * bars * sr)
    y = np.zeros(n, dtype=np.float32)
    beats = []
    for b in range(bars * 4):
        t = b * period
        beats.append(round(t, 4))
        i = int(t * sr)
        if b % 4 == kick_phase:                       # a 60 Hz thud on the true downbeat
            tt = np.arange(int(0.12 * sr)) / sr
            y[i:i + len(tt)] += (np.sin(2 * np.pi * 60 * tt) * np.exp(-tt * 25)).astype(np.float32)
        else:                                         # a quiet 4 kHz tick elsewhere
            tt = np.arange(int(0.02 * sr)) / sr
            y[i:i + len(tt)] += (0.2 * np.sin(2 * np.pi * 4000 * tt)).astype(np.float32)
    return y, sr, beats, period


def test_low_energy_peaks_on_the_kick_phase():
    y, sr, beats, _ = _kick_track(kick_phase=2)
    e = _low_energy_per_beat(y, sr, np.array(beats), hop=512, fmax=150.0)
    means = [e[p::4].mean() for p in range(4)]
    assert int(np.argmax(means)) == 2


def test_analyzer_moves_downbeats_to_the_kick():
    y, sr, beats, _ = _kick_track(kick_phase=2)
    # incoming downbeats claim phase 0 (the quiet beat); allin1 did NOT set them
    ctx = {"beats": beats, "downbeats": beats[0::4], "from_allin1": False}
    res = BarPhaseAnalyzer().analyze(y, sr, ctx)
    assert res.status == "ok"
    assert res.patch["downbeats"] == [round(t, 4) for t in beats[2::4]]
    assert res.patch["bar_phase_decision"]["to_phase"] == 2


def test_allin1_prior_is_not_overridden_without_margin():
    y, sr, beats, _ = _kick_track(kick_phase=2)
    # allin1 set phase 0; evidence favours 2 but the prior holds unless it clears the margin
    ctx = {"beats": beats, "downbeats": beats[0::4], "from_allin1": True}
    res = BarPhaseAnalyzer(margin=5.0).analyze(y, sr, ctx)   # absurd margin -> never override
    assert res.patch["downbeats"] == [round(t, 4) for t in beats[0::4]]
    assert res.patch["bar_phase_decision"]["moved_by_beats"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python -m pytest tests/test_bar_phase.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

Create `src/musicstate/analyzers/bar_phase.py`:

```python
"""L2 — the 4/4 phase whose bar-lines carry the kick, decided from the recording.

Ports listen/barphase.py. ear-style downbeats can sit on the quietest beat of the
bar; the low band (kick) says where the bar actually begins. allin1's downbeats are
a strong prior — overridden only if the low-band evidence clears a margin. Sections
are measured independently of phase here, so only downbeats move.
"""
from __future__ import annotations

import librosa
import numpy as np

from ..config import BAR_PHASE_FMAX, BAR_PHASE_MARGIN, HOP_LENGTH, N_FFT
from .base import Analyzer, AnalyzerResult


def _low_energy_per_beat(audio, sr, beats, hop=HOP_LENGTH, fmax=BAR_PHASE_FMAX):
    S = np.abs(librosa.stft(audio, n_fft=N_FFT, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    low = S[freqs <= fmax].sum(axis=0)
    times = librosa.frames_to_time(np.arange(low.shape[0]), sr=sr, hop_length=hop)
    idx = np.clip(np.searchsorted(times, np.asarray(beats)), 0, len(low) - 1)
    return low[idx]


class BarPhaseAnalyzer(Analyzer):
    name = "bar-phase"
    level = "L2"

    def __init__(self, hop_length=HOP_LENGTH, margin=BAR_PHASE_MARGIN):
        self.hop_length = hop_length
        self.margin = margin

    def analyze(self, audio, sample_rate, ctx):
        beats = ctx.get("beats") or []
        downbeats = ctx.get("downbeats") or []
        if len(beats) < 16 or not downbeats:
            return AnalyzerResult(status="not_computed",
                                  patch={"downbeats": downbeats}, notes="too few beats")
        cur = beats.index(downbeats[0]) if downbeats[0] in beats else 0
        e = _low_energy_per_beat(audio, sample_rate, beats, self.hop_length)
        total = float(e.mean()) or 1.0
        score = {p: float(e[p::4].mean()) / total for p in range(4)}   # >1 = kick sits here
        best = max(score, key=score.get)

        from_allin1 = bool(ctx.get("from_allin1"))
        override = score[best] > score[cur] * (1.0 + self.margin) if from_allin1 else True
        chosen = best if (override and best != cur) else cur

        new_downbeats = [round(float(t), 4) for t in beats[chosen::4]]
        decision = {
            "moved_by_beats": (chosen - cur) % 4 if chosen != cur else 0,
            "from_phase": cur, "to_phase": chosen,
            "decided_by": "low band (<=%d Hz) on the claimed bar lines vs the other beats" % BAR_PHASE_FMAX,
            "scores_by_phase": {str(p): round(score[p], 3) for p in range(4)},
            "allin1_prior": from_allin1,
            "why": "ear-style phase can land on the quietest beat of the bar; the kick says "
                   "where the bar begins. allin1 downbeats are a strong prior, overridden only "
                   "past a margin. Only downbeats move — sections are measured independently.",
        }
        return AnalyzerResult(
            status="ok",
            patch={"downbeats": new_downbeats, "bar_phase_decision": decision},
            confidence={"downbeats": round(min(1.0, score[chosen] / max(score.values())), 3)},
            ctx={"downbeats": new_downbeats},
            notes=f"phase {cur} -> {chosen}",
        )
```

In `config.py`:

```python
# --- bar-line phase (kick band) ---
BAR_PHASE_FMAX = 150.0      # Hz; the kick lives below this
BAR_PHASE_MARGIN = 0.15     # fraction the low band must beat allin1's phase by to override
```

In `port.py` observations, lift the decision (append-only):

```python
        "bar_phase_decision": state.get("bar_phase_decision"),
```

Register in `__init__.py` and `pipeline.py`: `BarPhaseAnalyzer()` **after** structure/allin1 and **before** `MomentDeriveAnalyzer()`.

Add a port test in `tests/test_port.py`:

```python
def test_bar_phase_decision_lifted_when_present():
    from musicstate.port import to_map
    obs = to_map({**STATE, "bar_phase_decision": {"to_phase": 2}})["observations"]
    assert obs["bar_phase_decision"]["to_phase"] == 2
    assert _m()["observations"]["bar_phase_decision"] is None   # null when unmeasured
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=src python -m pytest tests/test_bar_phase.py tests/test_port.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/musicstate/analyzers/bar_phase.py src/musicstate/config.py src/musicstate/port.py \
        src/musicstate/analyzers/__init__.py src/musicstate/pipeline.py \
        tests/test_bar_phase.py tests/test_port.py
git commit -m "pipeline: add BarPhaseAnalyzer (kick-band downbeat phase, allin1 prior)"
```

---

### Task 4: `MomentTimingAnalyzer` — re-time drops/stops to the loudness step

Ports `listen/moments.py`. Each drop/stop moves to the beat carrying the biggest sustained loudness step within two bars, constrained to half-bars unless an off-metre beat wins by >20%. Publishes an authoritative `events_retimed`; `port` prefers it.

**Files:**
- Create: `src/musicstate/analyzers/moment_timing.py`
- Modify: `src/musicstate/config.py`, `port.py` (prefer `events_retimed`; lift `moment_timing`), `analyzers/__init__.py`, `pipeline.py`
- Test: `tests/test_moment_timing.py`, `tests/test_port.py`

**Interfaces:**
- Consumes: `audio`, `ctx["beats"]`, `ctx["downbeats"]`, `ctx["tempo_bpm"]`, `ctx["events"]`.
- Produces: `MomentTimingAnalyzer` (`name="moment-timing"`, `level="L2"`), `patch={"events_retimed": [...], "moment_timing": {...}}`. Helpers `_envelope(audio, sr, hop_s) -> list[float]`, `_sustained(env, t, hop_s, shoulders) -> float | None`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_moment_timing.py`:

```python
import numpy as np
from musicstate.analyzers.moment_timing import MomentTimingAnalyzer, _envelope, _sustained


def _step_track(sr=22050, bpm=120, bars=8, step_beat=10):
    period = 60.0 / bpm
    n = int(period * 4 * bars * sr)
    y = (np.random.default_rng(0).standard_normal(n) * 0.02).astype(np.float32)
    beats = [round(b * period, 4) for b in range(bars * 4)]
    y[int(beats[step_beat] * sr):] += 0.5                # a sustained loudness step
    return y, sr, beats, period


def test_sustained_finds_the_step():
    y, sr, beats, _ = _step_track(step_beat=10)
    env = _envelope(y, sr, 0.005)
    on = _sustained(env, beats[10], 0.005, (0.5, 1.0, 1.5, 2.0))
    off = _sustained(env, beats[3], 0.005, (0.5, 1.0, 1.5, 2.0))
    assert on is not None and off is not None and on > off > -1


def test_retimes_a_mislabelled_drop_onto_the_step():
    y, sr, beats, _ = _step_track(step_beat=10)
    # a drop wrongly placed two beats early (beat 8); step is at beat 10
    ctx = {"beats": beats, "downbeats": beats[0::4], "tempo_bpm": 120.0,
           "events": [{"t": beats[8], "type": "drop", "conf": 0.7}]}
    res = MomentTimingAnalyzer().analyze(y, sr, ctx)
    drop = next(e for e in res.patch["events_retimed"] if e["type"] == "drop")
    assert abs(drop["t"] - beats[10]) < 1e-6
    assert res.patch["moment_timing"]["moved"][0]["now"] == round(beats[10], 6)


def test_no_drops_is_not_computed():
    y, sr, beats, _ = _step_track()
    ctx = {"beats": beats, "downbeats": beats[0::4], "tempo_bpm": 120.0,
           "events": [{"t": beats[4], "type": "build", "conf": 0.4}]}
    res = MomentTimingAnalyzer().analyze(y, sr, ctx)
    assert res.status == "not_computed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python -m pytest tests/test_moment_timing.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Write minimal implementation**

Create `src/musicstate/analyzers/moment_timing.py`:

```python
"""L2 — re-time drop/stop to the measured loudness step (ports listen/moments.py).

A drop is a sustained step in loudness, not a bar line. Each drop/stop moves to the
beat carrying the biggest median step across 0.5/1.0/1.5/2.0 s shoulders within two
bars, constrained to half-bar positions unless an off-metre beat beats the best
on-metre step by >20%. build/quiet are ramps and are left where they are. Produces
an authoritative events_retimed list; port prefers it.
"""
from __future__ import annotations

import math

from ..config import (MOMENT_HALF_BAR_OVERRIDE, MOMENT_SEARCH_BEATS,
                      MOMENT_SHOULDERS_S, MOMENT_STEP_HOP_S)
from .base import Analyzer, AnalyzerResult

_RISE, _FALL = {"drop"}, {"stop"}


def _envelope(audio, sr, hop_s=MOMENT_STEP_HOP_S):
    hop = max(1, int(sr * hop_s))
    out = []
    n = len(audio)
    for i in range(0, n - hop, hop):
        seg = audio[i:i + hop]
        out.append(math.sqrt(float((seg * seg).mean())))
    return out


def _step(env, t, sh, hop_s):
    w = max(1, int(sh / hop_s))
    i = int(t / hop_s)
    if i - w < 0 or i + w >= len(env):
        return None
    return sum(env[i:i + w]) / w - sum(env[i - w:i]) / w


def _sustained(env, t, hop_s, shoulders):
    v = [s for s in (_step(env, t, sh, hop_s) for sh in shoulders) if s is not None]
    if not v:
        return None
    v.sort()
    return v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2


class MomentTimingAnalyzer(Analyzer):
    name = "moment-timing"
    level = "L2"

    def analyze(self, audio, sample_rate, ctx):
        beats = ctx.get("beats") or []
        downbeats = ctx.get("downbeats") or []
        events = list(ctx.get("events") or [])
        bpm = ctx.get("tempo_bpm")
        per = (60.0 / bpm) if bpm else None
        retime = [e for e in events if e.get("type") in _RISE | _FALL]
        if not retime or len(beats) < 8 or not per:
            return AnalyzerResult(status="not_computed",
                                  patch={"events_retimed": events}, notes="nothing to re-time")

        bp = beats.index(downbeats[0]) if (downbeats and downbeats[0] in beats) else 0
        ph = beats[0]
        env = _envelope(audio, sample_rate)
        hop_s = MOMENT_STEP_HOP_S
        moved = []
        by_id = {id(e): e for e in events}
        for x in retime:
            t = x["t"]
            i0 = min(range(len(beats)), key=lambda i: abs(beats[i] - t))
            lo, hi = max(0, i0 - MOMENT_SEARCH_BEATS), min(len(beats), i0 + MOMENT_SEARCH_BEATS + 1)
            cands = [(_sustained(env, beats[i], hop_s, MOMENT_SHOULDERS_S), i) for i in range(lo, hi)]
            cands = [(s, i) for s, i in cands if s is not None]
            if not cands:
                continue
            on_half = [(s, i) for s, i in cands
                       if round((beats[i] - ph) / per - bp) % 2 == 0]
            pick = (lambda c: max(c)) if x["type"] in _RISE else (lambda c: min(c))
            if not on_half:
                j = pick(cands)[1]
            else:
                b_all, b_on = pick(cands), pick(on_half)
                j = b_all[1] if abs(b_all[0]) > abs(b_on[0]) * MOMENT_HALF_BAR_OVERRIDE else b_on[1]
            if abs(beats[j] - t) > 1e-6:
                moved.append({"kind": x["type"], "was": round(t, 6), "now": round(beats[j], 6),
                              "beats": round((beats[j] - t) / per, 2)})
                by_id[id(x)]["t"] = round(beats[j], 6)

        if not moved:
            return AnalyzerResult(status="not_computed",
                                  patch={"events_retimed": events}, notes="no moment moved")
        decision = {
            "how": "each drop and stop moved to the beat carrying the biggest sustained step in "
                   "loudness within two bars — the step is the median across 0.5/1.0/1.5/2.0 s "
                   "shoulders; half-bar positions are preferred unless an off-metre beat wins by 20%",
            "why": "drops land on bars or half bars; snapping to the nearest downbeat pushed them a "
                   "bar late",
            "moved": moved,
        }
        return AnalyzerResult(
            status="ok",
            patch={"events_retimed": events, "moment_timing": decision},
            notes=f"{len(moved)} moment(s) re-timed",
        )
```

In `config.py`:

```python
# --- moment re-timing (drops/stops -> the loudness step) ---
MOMENT_SEARCH_BEATS = 8            # two bars either side of the candidate
MOMENT_SHOULDERS_S = (0.5, 1.0, 1.5, 2.0)
MOMENT_HALF_BAR_OVERRIDE = 1.20    # an off-metre beat must beat the best on-metre step by this
MOMENT_STEP_HOP_S = 0.005          # RMS envelope hop
```

In `port.py`, prefer the re-timed events and lift the record:

```python
    events = state.get("events_retimed") or state.get("events") or []
```

```python
        "moment_timing": state.get("moment_timing"),
```

Register `MomentTimingAnalyzer()` in `__init__.py` and `pipeline.py` **after** `AccentsAnalyzer()` (so the accents exist for any future witness) — in both `core_analyzers()` and `deep_analyzers()`.

Add a port test in `tests/test_port.py`:

```python
def test_events_retimed_preferred_over_events():
    from musicstate.port import to_map
    st = {**STATE,
          "events": [{"t": 10.0, "type": "drop", "conf": 0.7}],
          "events_retimed": [{"t": 11.5, "type": "drop", "conf": 0.7}]}
    m = to_map(st)
    drop = next(x for x in m["moments"] if x["kind"] == "drop")
    assert drop["at"] == 11.5      # the re-timed position wins; no snap to a downbeat
    assert to_map(st)["observations"]["moment_timing"] is None  # null unless the analyzer wrote it
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `PYTHONPATH=src python -m pytest tests/test_moment_timing.py tests/test_port.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/musicstate/analyzers/moment_timing.py src/musicstate/config.py src/musicstate/port.py \
        src/musicstate/analyzers/__init__.py src/musicstate/pipeline.py \
        tests/test_moment_timing.py tests/test_port.py
git commit -m "pipeline: add MomentTimingAnalyzer (re-time drops/stops to the loudness step)"
```

---

### Task 5: Pipeline integration — ordering, allin1 ctx, schema, graceful degrade

Wire the deep stack in dependency order, mirror the ctx additions in `allin1.py`, declare the new state keys in the schema, and prove the whole pipeline stays green and degrades cleanly on the click track (which has no drops).

**Files:**
- Modify: `src/musicstate/pipeline.py` (`deep_analyzers` order), `src/musicstate/analyzers/allin1.py` (ctx), `src/musicstate/schema/musicstate.schema.json`
- Test: `tests/test_pipeline.py`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces: the deep order `dsp, structure, allin1, bar-phase, moment-derive, accents, chords, melody, moment-timing, stems, semantic, embedding, notes`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_pipeline.py`:

```python
def test_placement_analyzers_present_and_degrade(click_state):
    names = {a["name"]: a for a in click_state["provenance"]["analyzers"]}
    for n in ("bar-phase", "moment-derive", "moment-timing"):
        assert n in names, f"{n} not registered in core"
    # a steady click has no drops: derive/timing must no-op cleanly, not fail
    assert names["moment-derive"]["status"] in ("ok", "not_computed")
    assert names["moment-timing"]["status"] == "not_computed"
    assert names["moment-timing"]["status"] != "failed"


def test_schema_valid_with_new_keys(click_state):
    # bar-phase writes bar_phase_decision; assert the state still validates
    jsonschema.validate(click_state, SCHEMA)
    assert "bar_phase_decision" in click_state  # bar-phase ran on the click
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=src python -m pytest tests/test_pipeline.py::test_placement_analyzers_present_and_degrade -v`
Expected: FAIL — `moment-timing` not registered / key absent, until ordering is set.

- [ ] **Step 3: Write minimal implementation**

In `pipeline.py`, set `deep_analyzers()`:

```python
def deep_analyzers():
    return [
        DspAnalyzer(),
        StructureAnalyzer(),
        Allin1Analyzer(),
        BarPhaseAnalyzer(),        # kick-band downbeat phase (allin1 prior)
        MomentDeriveAnalyzer(),    # candidate drops/quiets from labels+energy
        AccentsAnalyzer(),
        ChordsAnalyzer(),
        MelodyAnalyzer(),
        MomentTimingAnalyzer(),    # re-time drops/stops to the loudness step
        StemsAnalyzer(),
        SemanticAnalyzer(),
        EmbeddingAnalyzer(),
        NoteTranscriptionAnalyzer(),
    ]
```

In `analyzers/allin1.py`, wherever it returns its `AnalyzerResult`, extend `ctx` to mirror structure so `MomentDeriveAnalyzer` reads allin1's superseding sections/downbeats/tempo. Add to the returned `ctx` dict (keys that allin1's patch writes):

```python
            ctx={"beats": patch["beats"], "downbeats": patch["downbeats"],
                 "sections": patch.get("sections", []),
                 "energy": patch.get("energy", []),
                 "tempo_bpm": (patch.get("meta_partial") or {}).get("tempo_bpm"),
                 "from_allin1": True},
```
(If allin1 does not compute `energy`, structure's `energy` remains in `ctx` from the earlier analyzer — do not overwrite it with an empty list; use `patch["energy"]` only if allin1 produced one, else omit the key so structure's survives.)

In `schema/musicstate.schema.json`, add these optional properties under the top-level `"properties"` (the schema has no `additionalProperties:false`, so this is documentation + guard, not a hard requirement):

```json
    "events_retimed": {"type": "array", "items": {"type": "object"}},
    "bar_phase_decision": {"type": ["object", "null"]},
    "moment_timing": {"type": ["object", "null"]}
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `PYTHONPATH=src python -m pytest -q`
Expected: PASS (all tests, all tasks).

- [ ] **Step 5: Commit**

```bash
git add src/musicstate/pipeline.py src/musicstate/analyzers/allin1.py \
        src/musicstate/schema/musicstate.schema.json tests/test_pipeline.py
git commit -m "pipeline: wire placement analyzers in order; allin1 ctx; schema; degrade test"
```

---

## Self-review

**Spec coverage:** bar-line phase → Task 3; drop/stop re-timing → Task 4; `pos`/groove → Task 1; moment-derivation relocated out of `port` → Task 2; allin1 strong-prior decision → Task 3 (`margin`, `from_allin1`); `port` fully pure for moments → Tasks 2+4; schema/tests/config conventions → every task. The spec's "reference expectation updated" consequence is realized as the `test_moments_six_kinds_and_drop_size` and moment tests asserting the new (un-snapped, re-timed) behavior.

**Placeholder scan:** none — every step carries runnable code; the one conditional instruction (allin1 `energy` key) states the exact rule.

**Type consistency:** `merge_sections` returns `{"at","to","name"}` (used by port + derive); events are `{"t","type","conf"[,"size"]}` throughout; `MomentTimingAnalyzer` mutates events in place and republishes them as `events_retimed`, which `port` reads with `state.get("events_retimed") or state.get("events")`; `ctx` keys (`sections`,`energy`,`tempo_bpm`,`events`,`downbeats`,`from_allin1`) are produced by structure/allin1/bar-phase and consumed by derive/timing consistently.

**Integration risk to watch during execution:** `MomentTimingAnalyzer` mutates the same event dicts that `MomentDeriveAnalyzer`/structure put in `ctx["events"]`; because `_merge` extends `state["events"]` with those same objects, the re-timed `t` also appears in raw `events`. That is why `port` reads `events_retimed` first (authoritative) and the raw list is kept only for provenance — confirm no test asserts on raw `events` positions after Task 4.
