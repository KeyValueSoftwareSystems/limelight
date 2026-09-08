"""Which beat of the four begins a bar, decided from the recording.

ear.py picks the bar phase from a band profile and then builds chapters, spans
and section entries AT that phase. Everything structural in the file therefore
agrees with the bar line by construction, and asking whether the chapters land on
bar lines cannot tell you whether the bar line is right -- it is the same circular
check the repo has already been caught by twice. On Mizhiyoram it hid a real
error: the claimed bar line carried 0.48x the low-band energy of the other beats,
meaning the bar began where the kick was quietest.

So the phase is decided by the audio and the structure derived from it moves with
it. Moments do NOT move: since listen/moments.py they are measured from the
recording rather than snapped to the grid, so their times are already right and
shifting them would break them -- which is exactly what a whole-file shift did
when it was tried (moments 0.90 -> 0.40).

What this does not settle. On Mizhiyoram the kick and the harmony disagree by a
half bar: the low band is loudest at phase 2 and the chroma turns over at phase 0.
Levels shows the same split, and there the drops -- measured, not snapped -- land
on the half bars, which is what a chord change on the half bar looks like. The
kick is followed here because a bar line you cannot hear is not one a reader can
use, and the disagreement is written into the map rather than resolved by
assertion. A human ear settles it, and nothing in this repository is one.

    python3 listen/barphase.py mizhiyoram --write
"""
import sys, os, json, copy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path
import mapeval as ME


def shifted(base, k, beats, per, cur):
    m = copy.deepcopy(base)
    for c in m.get("chapters") or []:
        c["at"] = round(c["at"] + k * per, 6)
        if "pos" in c: c["pos"] = round(c["pos"] + k, 4)
    for s in m.get("spans") or []:
        for f in ("from", "to"):
            if f in s: s[f] = round(s[f] + k * per, 6)
    if isinstance(m.get("sections"), dict):
        for e in m["sections"].get("entries") or []:
            if "at" in e: e["at"] = round(e["at"] + k * per, 6)
    ph = (cur + k) % 4
    m["grid"]["bar_phase"] = ph
    m["downbeats"] = [round(t, 6) for t in beats[ph::4]]
    m["chapters"] = sorted(m["chapters"], key=lambda c: c["at"])
    return m


def analyse(slug, write=False):
    p = map_path(slug)
    if not p: return {"error": "no map"}
    base = json.load(open(p))
    B = ME.audio_for(slug)[2]
    if B is None: return {"error": "no audio"}
    beats = base.get("beats") or []
    per = (base.get("grid") or {}).get("period")
    cur = (base.get("grid") or {}).get("bar_phase")
    if len(beats) < 16 or not per or cur is None: return {"error": "no grid"}

    # Both directions. A phase is reached by more than one displacement -- +3
    # beats and -1 beat land on the same bar line -- but they move the chapters a
    # whole bar apart, and only one of them leaves them where the recording
    # changes. Searching forward only chose +3 on Mizhiyoram and dropped the
    # sections check from 1.00 to 0.21, which is the map being made worse in
    # order to fix the bar line.
    rows = []
    for k in (-3, -2, -1, 0, 1, 2, 3):
        m = shifted(base, k, beats, per, cur)
        d = ME.ev_downbeats(m, B)
        rows.append({"shift": k, "phase": (cur + k) % 4,
                     "bar_line_energy": d[1], "downbeats": d[0],
                     "bars": ME.ev_bars(m, B)[0], "sections": ME.ev_sections(m, B)[0]})
    scorable = [r for r in rows if r["downbeats"] is not None]
    if not scorable:
        return {"slug": slug, "verdict": "this record carries no bar-line accent, so the "
                                         "phase cannot be decided from the low band. Left alone.",
                "rows": rows, "changed": False}
    # The recording decides the phase; among the displacements that reach that
    # phase, the one that keeps the chapters where the sound actually changes.
    best = max(scorable, key=lambda r: (round(r["downbeats"], 2), round(r["sections"] or 0, 2),
                                        round(r["bars"] or 0, 2), -abs(r["shift"])))
    if best["shift"] == 0:
        return {"slug": slug, "verdict": "the bar line is already where the recording puts it",
                "rows": rows, "changed": False}
    m = shifted(base, best["shift"], beats, per, cur)
    m.setdefault("observations", {})["bar_phase_decision"] = {
        "moved_by_beats": best["shift"],
        "from_phase": cur, "to_phase": best["phase"],
        "decided_by": "the low band on bar lines against the other beats, measured on this "
                      "recording -- " + str(best["bar_line_energy"]),
        "why_not_the_old_one": "the previous phase put the bar line on the quietest beat of the "
                               "four. The evidence for it was that the chapters agreed with it, "
                               "and ear.py builds chapters AT the bar phase, so that agreement "
                               "was arithmetic rather than evidence.",
        "what_moved": "chapters, spans and section entries, which are derived from the bar line. "
                      "Moments did not: they are measured from the recording by listen/moments.py "
                      "and shifting them made them worse.",
        "dissent": "harmonic change and bass note changes on this record favour a phase two beats "
                   "away -- a half bar. The kick and the chord change disagree, as they do on "
                   "Levels, and only an ear settles which one begins the bar.",
        "all_four_phases": rows}
    if write:
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False); open(p, "a").write("\n")
    return {"slug": slug, "rows": rows, "changed": True, "shift": best["shift"],
            "phase": best["phase"], "path": p}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]; write = "--write" in sys.argv
    for slug in (args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]):
        r = analyse(slug, write)
        if "error" in r: print("  %-16s %s" % (slug, r["error"])); continue
        print("  %-16s %s" % (slug, r.get("verdict") or
              "bar line moved %+d beats, phase %d -> %d%s" % (r["shift"], (r["phase"] - r["shift"]) % 4,
                                                              r["phase"], "  -> written" if write else "")))
        for row in r["rows"]:
            print("       shift %+d  phase %d  downbeats %-6s bars %.2f  sections %.2f  %s"
                  % (row["shift"], row["phase"],
                     ("%.2f" % row["downbeats"]) if row["downbeats"] is not None else "--",
                     row["bars"] or 0, row["sections"] or 0, row["bar_line_energy"][:40]))
