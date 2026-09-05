def compact(full):
    grid = full.get("grid") or {}
    beats = full.get("beats") or []
    downs = full.get("downbeats") or []
    period = grid.get("period")
    if not period and len(beats) > 1:
        gaps = [beats[i + 1] - beats[i] for i in range(len(beats) - 1)]
        period = sorted(gaps)[len(gaps) // 2]
    period = period or 0.5
    phase = grid.get("phase", beats[0] if beats else 0.0)
    dur = (full.get("song") or {}).get("length") or (beats[-1] if beats else 0.0)

    bar_phase = 0
    if beats and downs:
        keyed = {round(b, 3): i for i, b in enumerate(beats)}
        i = keyed.get(round(downs[0], 3))
        if i is not None:
            bar_phase = i % 4

    def moment(m):
        v = m.get("holds") if m.get("kind") == "stop" else m.get("size")
        return [m.get("at"), m.get("kind"), v]

    out = {
        "period": round(period, 6),
        "phase": round(phase, 6),
        "dur": round(dur, 3),
        "bar_phase": bar_phase,
        "beats": beats,
        "downbeats": downs,
        "chapters": [[c.get("at", 0.0), c.get("name", "verse")]
                     for c in (full.get("chapters") or [])],
        "spans": [[s.get("kind"), s.get("from"), s.get("to"), s.get("rise")]
                  for s in (full.get("spans") or [])],
        "moments": [moment(m) for m in (full.get("moments") or [])],
        "energy": full.get("energy") or [],
    }
    sections = full.get("sections")
    if isinstance(sections, dict):
        sections = sections.get("entries") or []
    if sections:
        out["sections"] = sections
    for k in ("stems", "accents", "observations", "grid", "chords", "proposal"):
        if full.get(k) is not None:
            out[k] = full[k]
    return out
