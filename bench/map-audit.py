#!/usr/bin/env python3
"""Is the map good? Field by field, with provenance, and what is NOT verified.

The map is the product; the light show is only evidence it works. So this asks
what a reader can actually rely on:

  present   the field is there and non-empty
  EMPTY     the field exists but carries nothing -- which is a legitimate answer
            under rule 2 and much better than a guess, but a reader loses it
  MISSING   no such field

and for every one of them, where the number came from. `how` is the whole safety
mechanism: `truth` is a human with the audio playing, `model` is what gets
graded, and nothing here is truth.
"""
import json, glob, os, sys

INTERFACE = ["grid", "beats", "downbeats", "chapters", "spans", "moments",
             "energy", "sections"]
OBSERVED  = ["stems", "accents"]

def size(v):
    if v is None: return None
    if isinstance(v, list): return len(v)
    if isinstance(v, dict):
        for k in ("events", "words", "value", "at", "entries", "sources"):
            if k in v and isinstance(v[k], (list, dict)): return len(v[k])
        return len(v)
    return 1

def row(name, v):
    n = size(v)
    if v is None: return "MISSING", 0
    if n in (0, None): return "EMPTY", 0
    return "ok", n

def audit(p):
    m = json.load(open(p))
    name = os.path.basename(p)[: -len(".map.json")]
    mb = m.get("made_by") or {}
    print("\n=== %s ===" % name)
    print("  made_by.how = %s   %s" % (mb.get("how"), (mb.get("note") or "")[:70]))
    miss = []
    print("  -- interface tier: a reader is allowed to depend on these --")
    for k in INTERFACE:
        st, n = row(k, m.get(k))
        print("     %-12s %-8s %s" % (k, st, n or ""))
        if st != "ok": miss.append(k)
    print("  -- observation tier: a reader uses it if it recognises it --")
    for k in OBSERVED:
        st, n = row(k, m.get(k))
        print("     %-12s %-8s %s" % (k, st, n or ""))
    obs = m.get("observations") or {}
    for k in sorted(obs):
        st, n = row(k, obs[k])
        how = (obs[k].get("how") if isinstance(obs[k], dict) else None) or ""
        print("     obs.%-8s %-8s %-6s %s" % (k, st, n or "", how[:52]))
    return name, miss, mb.get("how")

if __name__ == "__main__":
    paths = sys.argv[1:] or sorted(glob.glob("maps/model/*.map.json"))
    out = []
    for p in paths: out.append(audit(p))
    print("\n=== what a reader cannot rely on ===")
    for name, miss, how in out:
        print("  %-20s how=%-10s %s" % (name, how, ", ".join(miss) or "interface tier complete"))
    print("\n  No map here is `truth`. `model` means a listener measured it from a")
    print("  recording, which is the thing that gets graded, not the grader.")
