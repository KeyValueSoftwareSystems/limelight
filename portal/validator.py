"""Validate a show plan returned by the LLM composer.

Every check is mechanically testable. The validator is not optional and is not
the model's job. See architecture.md for the design.

Returns (cleaned_plan, report) where cleaned_plan is the plan with invalid entries
removed, and report is a list of issues found.
"""
import json


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
    sections = score_overview.get("sections") or []
    moments = score_overview.get("moments") or []
    streams = set()
    for s in (score_overview.get("streams") or score_overview.get("lanes") or []):
        if isinstance(s, str):
            streams.add(s)
        elif isinstance(s, dict):
            streams.add(s.get("name", s.get("id", "")))

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
        # check streams
        for key in ("stream", "streams"):
            val = b.get(key)
            if val is None:
                continue
            names = [val] if isinstance(val, str) else (val if isinstance(val, list) else [])
            for name in names:
                if name and name not in streams:
                    report.append({"level": "error", "msg": f"binding[{i}]: stream '{name}' not in overview"})
        if not b.get("why"):
            report.append({"level": "warn", "msg": f"binding[{i}]: no 'why'"})
        clean_bindings.append(b)

    clean_gestures = []
    for i, g in enumerate(plan.get("gestures") or []):
        eid = g.get("effect")
        if eid not in effects_by_id:
            report.append({"level": "error", "msg": f"gesture[{i}]: unknown effect '{eid}'"})
            continue
        edef = effects_by_id[eid]
        if edef["kind"] not in ("gesture",):
            report.append({"level": "error", "msg": f"gesture[{i}]: '{eid}' is a {edef['kind']}, not a gesture"})
            continue
        # check moment references
        if "moment" in g:
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
            report.append({"level": "error", "msg": f"gesture[{i}]: no moment or from_moment/to_moment anchor"})
            continue
        if not g.get("why"):
            report.append({"level": "warn", "msg": f"gesture[{i}]: no 'why'"})
        clean_gestures.append(g)

    # collision detection: same dimension at the same time
    # gestures beat bindings beat states; larger magnitude wins ties
    collisions = _detect_collisions(clean_gestures, clean_bindings, clean_states,
                                     effects_by_id, moments, sections)
    report.extend(collisions)

    cleaned = {
        "plan": plan.get("plan", ""),
        "states": clean_states,
        "bindings": clean_bindings,
        "gestures": clean_gestures,
    }

    errors = [r for r in report if r["level"] == "error"]
    return cleaned, report


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
