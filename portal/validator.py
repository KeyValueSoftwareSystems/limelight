"""Validate a show plan returned by the LLM composer.

Every check is mechanically testable. The validator is not optional and is not
the model's job. See architecture.md for the design.

Returns (cleaned_plan, report) where cleaned_plan is the plan with invalid entries
removed, and report is a list of issues found.
"""
import json


def _as_rgb(c):
    if isinstance(c, str) and c.startswith("#") and len(c) == 7:
        try:
            return [int(c[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
        except ValueError:
            return None
    if isinstance(c, (list, tuple)) and len(c) == 3:
        try:
            return [max(0.0, min(1.0, float(x))) for x in c]
        except (TypeError, ValueError):
            return None
    return None


COLOUR_KEYS = ("colour", "under", "to", "from", "bed_colour")


def _derive_palette(plan, keep=5, near=0.06):
    """The colours the designer actually used, merged down to a handful.

    A plan that declares no palette gets one built from its own cues rather
    than a set invented here: every colour is counted, the commonest becomes an
    entry, and everything within `near` of it is folded in. That consolidates
    the designer's choices instead of overriding them."""
    seen = {}
    for key in ("states", "bindings", "gestures"):
        for e in plan.get(key) or []:
            for f in COLOUR_KEYS:
                v = e.get(f)
                vals = v if isinstance(v, list) and v and isinstance(v[0], (list, str)) else [v]
                for one in vals:
                    rgb = _as_rgb(one)
                    if rgb:
                        key = tuple(round(float(x), 4) for x in rgb)
                        seen[key] = seen.get(key, 0) + 1
    out = []
    pool = sorted(seen.items(), key=lambda kv: -kv[1])
    while pool and len(out) < keep:
        rgb, _ = pool.pop(0)
        out.append((f"c{len(out) + 1}", rgb))
        pool = [(c, n) for c, n in pool
                if sum((a - b) ** 2 for a, b in zip(c, rgb)) > near]
    return out


def _snap_palette(plan, report):
    palette = []
    for entry in (plan.get("palette") or []):
        rgb = _as_rgb(entry.get("rgb") if isinstance(entry, dict) else entry)
        if rgb:
            palette.append((entry.get("name", "?") if isinstance(entry, dict) else "?", rgb))
    if not palette:
        return
    def nearest(rgb):
        best, bd = None, 9e9
        for nm, p in palette:
            d = sum((a - b) ** 2 for a, b in zip(rgb, p))
            if d < bd:
                best, bd = (nm, p), d
        return best, bd
    moved = 0
    for key in ("states", "bindings", "gestures"):
        for e in plan.get(key) or []:
            for f in COLOUR_KEYS:
                rgb = _as_rgb(e.get(f))
                if rgb is None:
                    continue
                (nm, p), d = nearest(rgb)
                if d > 1e-6:
                    e[f] = [round(x, 3) for x in p]
                    moved += 1
            arr = e.get("colours")
            if isinstance(arr, list):
                out = []
                for c in arr:
                    rgb = _as_rgb(c)
                    if rgb is None:
                        out.append(c)
                        continue
                    (nm, p), d = nearest(rgb)
                    if d > 1e-6:
                        moved += 1
                    out.append([round(x, 3) for x in p])
                e["colours"] = out
    if moved:
        report.append({"level": "warn", "code": "palette_snapped",
                       "msg": f"{moved} colour value(s) were not in the declared palette "
                              f"of {len(palette)} and were snapped to the nearest one"})


def _onset_ceiling(overview):
    try:
        import composer as C
        sc = C._score_of(overview) if overview.get("_song") else {}
    except Exception:
        return 0.0
    hits = ((sc.get("rhythm") or {}).get("hits")) or []
    forces = [h.get("intensity") for h in hits
              if isinstance(h, dict) and isinstance(h.get("intensity"), (int, float))]
    return max(forces) if forces else 0.0


def _lanes_of(overview):
    try:
        import composer as C
        sc = C._score_of(overview) if overview.get("_song") else {}
    except Exception:
        return {}, 0.5
    stp = sc.get("stems_temporal") or {}
    lanes = stp.get("stems") or {}
    live = {k: v for k, v in lanes.items() if isinstance(v, list) and v and max(v) > 0.15}
    return live, (stp.get("window_s") or 0.5)


def validate(plan, catalog, score_overview):
    """Validate a composer's show plan against the catalog and score.

    Args:
        plan: dict with keys 'plan', 'states', 'bindings', 'gestures'
        catalog: list of effect dicts from effects.json
        score_overview: dict with 'sections', 'moments', 'streams' from the hub

    Returns:
        (cleaned_plan, report) where report is a list of issue dicts.
    """
    report = []
    effects_by_id = {e["id"]: e for e in catalog}
    for d in (plan.get("effects") or []) if isinstance(plan, dict) else []:
        if isinstance(d, dict) and d.get("id") and d.get("body"):
            effects_by_id.setdefault(d["id"], {
                "id": d["id"],
                "kind": d.get("kind", "gesture"),
                "dimension": d.get("dimension", "amount"),
                "dials": d.get("dials") or {},
                "also_gesture": True,
            })
    sections = score_overview.get("sections") or []
    moments = score_overview.get("moments") or []
    GRID_STREAMS = {"beat", "downbeat", "bar"}
    streams = set()
    for s in (score_overview.get("streams") or score_overview.get("lanes") or []):
        if isinstance(s, str):
            streams.add(s)
        elif isinstance(s, dict):
            streams.add(s.get("name", s.get("id", "")))
    if not streams:
        lanes, _w = _lanes_of(score_overview)
        streams = set((lanes or {}).keys())

    if not isinstance(plan, dict):
        return {"plan": "", "states": [], "bindings": [], "gestures": []}, \
               [{"level": "fatal", "msg": "plan is not a dict"}]

    if not plan.get("plan"):
        report.append({"level": "warn", "msg": "no plan sentence"})

    clean_states = []
    for i, s in enumerate(plan.get("states") or []):
        eid = s.get("effect")
        if eid not in effects_by_id:
            report.append({"level": "error", "msg": f"state[{i}]: unknown effect '{eid}'"})
            continue
        edef = effects_by_id[eid]
        if edef["kind"] != "state":
            report.append({"level": "error", "msg": f"state[{i}]: '{eid}' is a {edef['kind']}, not a state"})
            continue
        sec_idx = s.get("section")
        if sec_idx is None or not isinstance(sec_idx, int) or sec_idx < 0 or sec_idx >= len(sections):
            report.append({"level": "error", "msg": f"state[{i}]: section index {sec_idx} out of range (0..{len(sections)-1})"})
            continue
        if not s.get("why"):
            report.append({"level": "warn", "msg": f"state[{i}]: no 'why'"})
        clean_states.append(s)

    # coverage: every section must have a resting state, or it bakes black. Fill
    # any uncovered section with an ENERGY-appropriate bed, varied from its
    # neighbour, so a misbehaving model never means a dark OR monotonous show.
    state_ids = [e["id"] for e in catalog if e.get("kind") == "state"]
    covered = {s.get("section"): s for s in clean_states if isinstance(s.get("section"), int)}
    energies = [_section_energy(sec, score_overview) for sec in sections]
    emax = max([e for e in energies if e is not None], default=None)
    def _norm(e):
        return 0.4 if (e is None or not emax) else max(0.0, min(1.0, e / emax))
    for i in range(len(sections)):
        if i in covered:
            continue
        prev = covered.get(i - 1)
        fill = _fill_state(i, _norm(energies[i]), state_ids, prev.get("effect") if prev else None)
        if fill is None:
            report.append({"level": "warn", "msg": f"section[{i}] has no state and none could be filled"})
            continue
        covered[i] = fill
        clean_states.append(fill)
        report.append({"level": "warn", "code": "state_filled", "section": i,
                       "msg": f"section[{i}] had no state; filled with {fill['effect']}"})
    clean_states.sort(key=lambda s: s.get("section", 0) if isinstance(s.get("section"), int) else 0)

    clean_bindings = []
    for i, b in enumerate(plan.get("bindings") or []):
        eid = b.get("effect")
        if eid not in effects_by_id:
            report.append({"level": "error", "msg": f"binding[{i}]: unknown effect '{eid}'"})
            continue
        edef = effects_by_id[eid]
        if edef["kind"] != "binding":
            report.append({"level": "error", "msg": f"binding[{i}]: '{eid}' is a {edef['kind']}, not a binding"})
            continue
        sec_idx = b.get("section")
        if sec_idx is None or not isinstance(sec_idx, int) or sec_idx < 0 or sec_idx >= len(sections):
            report.append({"level": "error", "msg": f"binding[{i}]: section index {sec_idx} out of range"})
            continue
        # check streams — a binding to an unknown stream would render as a dead
        # constant (the baker samples 0), so DROP it rather than keep it. The
        # error also gives the model a chance to fix the name on retry.
        bad_stream = False
        for key in ("stream", "streams"):
            val = b.get(key)
            if val is None:
                continue
            names = [val] if isinstance(val, str) else (val if isinstance(val, list) else [])
            for name in names:
                if name and streams and name not in streams and name not in GRID_STREAMS:
                    report.append({"level": "error", "msg": f"binding[{i}]: stream '{name}' not in overview (dropped)"})
                    bad_stream = True
        if bad_stream:
            continue
        if not b.get("why"):
            report.append({"level": "warn", "msg": f"binding[{i}]: no 'why'"})
        if eid == "accent":
            thr = b.get("threshold")
            top = _onset_ceiling(score_overview)
            if isinstance(thr, (int, float)) and top > 0 and thr > top * 0.55:
                was = thr
                b = dict(b)
                b["threshold"] = round(top * 0.25, 3)
                report.append({
                    "level": "warn", "code": "threshold_unreachable",
                    "msg": f"binding[{i}]: accent threshold {was} is above what the onset "
                           f"envelope reaches ({top:.2f}); it would never fire. "
                           f"Lowered to {b['threshold']}."})
        clean_bindings.append(b)

    clean_gestures = []
    for i, g in enumerate(plan.get("gestures") or []):
        eid = g.get("effect")
        if eid not in effects_by_id:
            report.append({"level": "error", "msg": f"gesture[{i}]: unknown effect '{eid}'"})
            continue
        edef = effects_by_id[eid]
        if edef["kind"] not in ("gesture",) and not edef.get("also_gesture"):
            report.append({"level": "error", "msg": f"gesture[{i}]: '{eid}' is a {edef['kind']}, not a gesture"})
            continue
        # check anchors: a bar/beat position on the grid, or a measured moment
        bars = (score_overview.get("grid") or {}).get("bars")
        if "at_bar" in g or ("from_bar" in g and "to_bar" in g):
            vals = [g.get(k) for k in ("at_bar", "from_bar", "to_bar") if k in g]
            bad = [v for v in vals if not isinstance(v, (int, float)) or v < 1]
            if bad:
                report.append({"level": "error", "msg": f"gesture[{i}]: bar {bad[0]} is not a bar number"})
                continue
            if isinstance(bars, int) and bars > 0:
                over = [v for v in vals if v > bars]
                if over:
                    report.append({"level": "error",
                                   "msg": f"gesture[{i}]: bar {over[0]} is past the end of the song ({bars} bars)"})
                    continue
        elif "moment" in g:
            mi = g["moment"]
            if not isinstance(mi, int) or mi < 0 or mi >= len(moments):
                report.append({"level": "error", "msg": f"gesture[{i}]: moment {mi} out of range (0..{len(moments)-1})"})
                continue
        elif "from_moment" in g and "to_moment" in g:
            fm, tm = g["from_moment"], g["to_moment"]
            if not isinstance(fm, int) or fm < 0 or fm >= len(moments):
                report.append({"level": "error", "msg": f"gesture[{i}]: from_moment {fm} out of range"})
                continue
            if not isinstance(tm, int) or tm < 0 or tm >= len(moments):
                report.append({"level": "error", "msg": f"gesture[{i}]: to_moment {tm} out of range"})
                continue
        else:
            report.append({"level": "error",
                           "msg": f"gesture[{i}]: no anchor - give it at_bar (with an optional at_beat), "
                                  f"from_bar/to_bar, a moment, or from_moment/to_moment"})
            continue
        if not g.get("why"):
            report.append({"level": "warn", "msg": f"gesture[{i}]: no 'why'"})
        clean_gestures.append(g)

    # collision detection: same dimension at the same time
    # gestures beat bindings beat states; larger magnitude wins ties
    _snap_palette({"palette": plan.get("palette"), "states": clean_states,
                   "palette": plan.get("palette") or [],
        "bindings": clean_bindings, "gestures": clean_gestures}, report)

    collisions = _detect_collisions(clean_gestures, clean_bindings, clean_states,
                                     effects_by_id, moments, sections)
    report.extend(collisions)

    # variety: neighbouring beds shouldn't match, and the same gesture shouldn't
    # cluster in time. Warnings, not errors — the prompt prevents these; this
    # surfaces any that slip through. Generic, no song-specific rule.
    ss = sorted(clean_states, key=lambda s: s.get("section", 0) if isinstance(s.get("section"), int) else 0)
    for a, b in zip(ss, ss[1:]):
        if isinstance(a.get("section"), int) and b.get("section") == a.get("section") + 1 \
                and a.get("effect") == b.get("effect"):
            report.append({"level": "warn", "code": "repeat_bed",
                           "msg": f"sections {a['section']} & {b['section']} share bed '{a['effect']}' — vary it"})
    gg = sorted(clean_gestures, key=lambda g: _gesture_time(g, moments))
    for a, b in zip(gg, gg[1:]):
        if a.get("effect") == b.get("effect") \
                and abs(_gesture_time(b, moments) - _gesture_time(a, moments)) < 3.5:
            report.append({"level": "warn", "code": "cluster",
                           "msg": f"two '{a['effect']}' within 3.5s — alternate the effect, colour or extent"})

    cleaned = {
        "plan": plan.get("plan", ""),
        "states": clean_states,
        "bindings": clean_bindings,
        "gestures": clean_gestures,
    }

    errors = [r for r in report if r["level"] == "error"]
    return cleaned, report


def _section_energy(section, overview):
    """Best-effort mean per-bar energy for a section, 0..1-ish, or None."""
    energy = None
    curves = overview.get("curves")
    if isinstance(curves, dict):
        energy = curves.get("energy")
    if energy is None:
        energy = overview.get("energy")
    if isinstance(energy, dict):
        energy = energy.get("values")
    if not isinstance(energy, list) or not energy:
        return None
    fb = (section.get("from") or {}).get("bar")
    tb = (section.get("to") or {}).get("bar")
    if not isinstance(fb, int) or not isinstance(tb, int):
        return None
    lo = max(0, fb - 1)
    hi = min(len(energy), max(lo + 1, tb - 1))
    seg = [v for v in energy[lo:hi] if isinstance(v, (int, float))]
    if not seg:
        return None
    return sum(seg) / len(seg)


def _gesture_time(g, moments):
    """When a gesture fires, in seconds — for the cluster check."""
    if g.get("at_s") is not None:
        return g["at_s"]
    if g.get("from_s") is not None:
        return g["from_s"]
    for k in ("moment", "from_moment"):
        mi = g.get(k)
        if isinstance(mi, int) and 0 <= mi < len(moments):
            return moments[mi].get("time_s") or moments[mi].get("at_s") or 0
    return 0


def _fill_state(i, e01, state_ids, avoid=None):
    """A resting bed for an uncovered section, chosen by its normalised energy
    (0..1) and nudged off the neighbour's bed so fills don't repeat. Generic —
    energy tiers, not a per-song rule. None only if the catalog has no state."""
    if not state_ids:
        return None
    order = [n for n in ("drone", "pulse", "wash", "drive") if n in state_ids] or list(state_ids)
    thr = {"drone": 0.0, "pulse": 0.28, "wash": 0.5, "drive": 0.72}
    pick = order[0]
    for n in order:
        if e01 >= thr.get(n, 0):
            pick = n
    if pick == avoid and len(order) > 1:
        idx = order.index(pick)
        pick = order[idx - 1] if idx > 0 else order[idx + 1]
    return _state_entry(i, pick, e01)


def _state_entry(i, eff, e01):
    base = {"section": i, "effect": eff, "author": "validator",
            "why": "auto-filled: composer left this section without a resting state"}
    if eff == "pulse":
        base.update(amount=round(0.35 + 0.25 * e01, 2), colour=[0.2, 0.45, 1], extent="all", floor=round(0.14 + 0.1 * e01, 2))
    elif eff == "wash":
        base.update(amount=round(0.40 + 0.30 * e01, 2), colour=[0.3, 0.35, 0.6], extent="all")
    elif eff == "drive":
        base.update(amount=round(0.70 + 0.30 * e01, 2), colours=[[0.2, 0.4, 1], [1, 0.4, 0.6]], floor=round(0.45 + 0.15 * e01, 2))
    elif eff == "breakdown":
        base.update(amount=round(0.40 + 0.20 * e01, 2), colours=[[0, 0, 1], [1, 0, 0.55]], floor=0.1)
    else:  # drone
        base.update(amount=round(0.08 + 0.12 * e01, 2), colour=[1, 0.75, 0.35], extent="inner")
    return base


def _detect_collisions(gestures, bindings, states, effects_by_id, moments, sections):
    """Detect two things on the same dimension at the same time.
    Returns a list of warning-level report entries for losers."""
    issues = []
    # group gestures by dimension
    by_dim = {}
    for i, g in enumerate(gestures):
        eid = g.get("effect")
        edef = effects_by_id.get(eid)
        if not edef:
            continue
        dim = edef.get("dimension", "amount")
        by_dim.setdefault(dim, []).append((i, g))

    for dim, gs in by_dim.items():
        if len(gs) < 2:
            continue
        # check pairwise for overlapping moments
        for a_idx in range(len(gs)):
            for b_idx in range(a_idx + 1, len(gs)):
                ai, ag = gs[a_idx]
                bi, bg = gs[b_idx]
                if _gestures_overlap(ag, bg, moments):
                    issues.append({
                        "level": "warn",
                        "msg": f"gesture[{ai}] ({ag.get('effect')}) and gesture[{bi}] ({bg.get('effect')}) "
                               f"overlap on dimension '{dim}'; higher-priority wins at render time"
                    })
    return issues


def _gestures_overlap(a, b, moments):
    """Rough overlap check using moment indices."""
    def moment_range(g):
        if "moment" in g:
            m = g["moment"]
            fb = g.get("for_beats", 1)
            return (m, m)
        if "from_moment" in g and "to_moment" in g:
            return (g["from_moment"], g["to_moment"])
        return (0, 0)
    ar = moment_range(a)
    br = moment_range(b)
    return ar[0] <= br[1] and br[0] <= ar[1]


def format_report(report):
    """Format the validation report as a human-readable string."""
    if not report:
        return "validation passed with no issues"
    lines = []
    for r in report:
        lines.append(f"[{r['level']}] {r['msg']}")
    errors = sum(1 for r in report if r["level"] == "error")
    warns = sum(1 for r in report if r["level"] == "warn")
    lines.append(f"--- {errors} error(s), {warns} warning(s)")
    return "\n".join(lines)
