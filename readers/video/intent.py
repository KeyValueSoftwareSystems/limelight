#!/usr/bin/env python3
"""Ask a model for creative intent, then refuse most of what it could say.

    python3 readers/video/intent.py --slug levels --brief premium-restraint

WHERE THE LLM IS ALLOWED TO STAND. At interpretation, and nowhere else. It is
given measurements it did not make and asked what to DO about them. It never
writes a number that anything downstream treats as measured, and it never names
a timestamp: every moment it can act on is offered as an indexed candidate, and
it replies with indices. A model that could type "cut at 93.6" could type "cut at
94.1", and nothing in the file would show which of those was measured and which
was invented -- which is the whole failure mode this repo is organised against.

So the contract is narrow on purpose. It may:
   - choose which candidate moments deserve a cut, by index
   - declare holds over candidate ranges, with a reason
   - set a shot-length intent per section, inside the brief's own bounds
   - say what it is doing and why, in prose, for the record

It may not:
   - invent times, durations, energies, or any other measurement
   - exceed the brief's cut budget
   - reference a clip (choosing footage is the compiler's job, over measured
     fit, so that a policy difference is never a footage-taste difference)

THE OUTPUT IS COMMITTED. `intent.json` is an artifact, not a runtime call. Given
the same intent file, the same edit renders forever, which is what keeps
`frame = f(map, layout, recipe, t)` true for this lane too. Re-running this
script is a deliberate act that produces a new file, reviewable as a diff.

EVERYTHING IS VALIDATED. Nothing the model says is trusted: indices must exist,
holds must lie inside the song, budgets must hold, and prose fields are carried
as prose and never parsed for numbers. A response that fails validation is
rejected with the reason, not repaired -- repairing it would make the failure
invisible next time.
"""
import argparse, json, os, subprocess, sys, textwrap

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(ROOT)
sys.path.insert(0, os.path.join(ROOT, "listen"))
from mapio import map_path


def candidates(slug, brief_id):
    """The same candidate list policy_rules builds -- from policy_rules itself,
    so the two policies are choosing from an identical menu and a difference
    between them is a difference in judgement."""
    js = """
let raw='';process.stdin.on('data',c=>raw+=c).on('end',()=>{
  const req=JSON.parse(raw), fs=require('fs');
  const P=require(req.policy), D=require(req.derive);
  const m=JSON.parse(fs.readFileSync(req.map,'utf8'));
  const dur=(m.song&&m.song.length)||0;
  const d=D.make(m);
  process.stdout.write(JSON.stringify(P.candidates(m,dur,d)));
});
"""
    r = subprocess.run(["node", "-e", js], input=json.dumps({
        "policy": os.path.join(ROOT, "readers", "video", "policy_rules.js"),
        "derive": os.path.join(ROOT, "readers", "src", "derive.js"),
        "map": map_path(slug)}), capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[:400])
    return json.loads(r.stdout)


def song_summary(m):
    secs = (m.get("sections") or {}).get("entries") or []
    return [{"at": round(s.get("at", 0), 2), "name": s.get("name"),
             "repeat": s.get("repeat"), "mean_energy": s.get("mean_energy")}
            for s in secs]


def build_prompt(slug, m, brief, cands, index):
    dur = m["song"]["length"]
    allowed = max(1, round(brief["budgets"]["cuts_per_minute"] * dur / 60))
    shots = [s for c in index["clips"] for s in c["shots"]]

    def rng(k):
        v = [s[k] for s in shots if s.get(k) is not None]
        return f"{min(v):.0f}-{max(v):.0f}" if v else "unmeasured"

    lines = []
    for i, c in enumerate(cands):
        lines.append(f"  [{i:3}] t={c['t']:7.2f}s  {c['kind']:11} "
                     f"strength={c['strength']:.3f} ({c['strength_is']})")
    return textwrap.dedent(f"""\
    You are choosing where a video edit should cut. You are NOT measuring
    anything: every number below was measured by other tools and is given to you.

    SONG: {slug}, {dur:.1f}s long.
    Sections (time, name, which repeat it is, mean energy):
    {json.dumps(song_summary(m), indent=1)}

    CANDIDATE MOMENTS. These are the only places you may cut. Refer to them by
    index. `strength` is a measured ranking of how much the music changes there;
    it is UNCORROBORATED (no independent check confirms it) so treat it as one
    opinion, not as truth.
    {chr(10).join(lines)}

    THE BRIEF (this job's taste, not a description of the song):
    {json.dumps(brief, indent=1)}

    THE FOOTAGE, in aggregate. You do not choose clips -- a separate step picks
    the best-fitting shot for each slot. This is only so you know what is
    available: {len(shots)} shots, durations {rng('duration')}s,
    camera motion {rng('camera_motion_px_s')} px/s,
    subject motion {rng('subject_motion_px_s')} px/s,
    brightness {rng('brightness')}.

    YOUR JOB. Spend at most {allowed} cuts. You will usually want fewer: a hold
    is a real decision, and the brief's restraint settings say how much this job
    values one. Think about the whole song before the beginning of it -- what you
    decline at 45s is what makes 50s land.

    Reply with ONLY this JSON, no prose outside it:
    {{
      "strategy": "one or two sentences on the shape of the whole edit",
      "cut_indices": [list of candidate indices you are spending a cut on],
      "holds": [
        {{"from_index": <candidate index or null for song start>,
          "to_index": <candidate index or null for song end>,
          "reason": "why nothing should happen through here"}}
      ],
      "notes": "anything you declined and why"
    }}

    Rules that will be checked and will cause rejection:
      - every index must exist in the list above
      - at most {allowed} entries in cut_indices
      - do not invent times, durations or any other number
      - holds must not overlap each other
    """)


def validate(out, cands, allowed, dur):
    errs = []
    if not isinstance(out, dict):
        return ["response is not an object"]
    ci = out.get("cut_indices")
    if not isinstance(ci, list) or not ci:
        errs.append("cut_indices missing or empty")
        ci = []
    for i in ci:
        if not isinstance(i, int) or not (0 <= i < len(cands)):
            errs.append(f"cut index {i!r} is not a candidate")
    if len(ci) > allowed:
        errs.append(f"{len(ci)} cuts exceeds the budget of {allowed}")
    if len(set(ci)) != len(ci):
        errs.append("cut_indices repeats an index")
    holds = out.get("holds") or []
    if not isinstance(holds, list):
        errs.append("holds is not a list")
        holds = []
    spans = []
    for h in holds:
        if not isinstance(h, dict):
            errs.append("a hold is not an object")
            continue
        a = h.get("from_index")
        b = h.get("to_index")
        for k, v in (("from_index", a), ("to_index", b)):
            if v is not None and (not isinstance(v, int) or not (0 <= v < len(cands))):
                errs.append(f"hold {k}={v!r} is not a candidate")
        if not str(h.get("reason", "")).strip():
            errs.append("a hold has no reason")
        ta = 0.0 if a is None else cands[a]["t"] if isinstance(a, int) and 0 <= a < len(cands) else None
        tb = dur if b is None else cands[b]["t"] if isinstance(b, int) and 0 <= b < len(cands) else None
        if ta is not None and tb is not None:
            if tb <= ta:
                errs.append(f"hold {ta:.2f}->{tb:.2f} does not move forward")
            spans.append((ta, tb))
    spans.sort()
    for i in range(1, len(spans)):
        if spans[i][0] < spans[i - 1][1] - 1e-6:
            errs.append(f"holds overlap at {spans[i][0]:.2f}")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True)
    ap.add_argument("--brief", default="premium-restraint")
    ap.add_argument("--out")
    ap.add_argument("--timeout", type=int, default=240)
    ap.add_argument("--print-prompt", action="store_true")
    a = ap.parse_args()

    m = json.load(open(map_path(a.slug)))
    brief = json.load(open(os.path.join(ROOT, "briefs", a.brief + ".json")))
    index = json.load(open(os.path.join(ROOT, "assets", "INDEX.json")))
    cands = candidates(a.slug, a.brief)
    dur = m["song"]["length"]
    allowed = max(1, round(brief["budgets"]["cuts_per_minute"] * dur / 60))

    prompt = build_prompt(a.slug, m, brief, cands, index)
    if a.print_prompt:
        print(prompt)
        return 0

    r = subprocess.run(["claude", "-p", prompt], capture_output=True, text=True,
                       timeout=a.timeout)
    if r.returncode != 0:
        print("claude failed: " + r.stderr[:400], file=sys.stderr)
        return 1
    text = r.stdout.strip()
    s, e = text.find("{"), text.rfind("}")
    if s < 0 or e <= s:
        print("no JSON in the reply:\n" + text[:500], file=sys.stderr)
        return 1
    try:
        out = json.loads(text[s:e + 1])
    except json.JSONDecodeError as ex:
        print(f"reply is not valid JSON: {ex}", file=sys.stderr)
        return 1

    errs = validate(out, cands, allowed, dur)
    if errs:
        print("REJECTED -- the reply is not repaired, it is refused:", file=sys.stderr)
        for x in errs[:15]:
            print("  " + x, file=sys.stderr)
        return 1

    doc = {
        "intent": "0.1",
        "made_by": {"how": "llm", "who": "claude -p via readers/video/intent.py",
                    "not": ("no number here was produced by the model. It chose "
                            "among candidate indices measured by other tools."),
                    "slug": a.slug, "brief": a.brief},
        "budget_allowed": allowed,
        "strategy": str(out.get("strategy", ""))[:1000],
        "notes": str(out.get("notes", ""))[:2000],
        "cut_indices": sorted(set(out["cut_indices"])),
        "holds": out.get("holds") or [],
        "candidates": [{"i": i, "t": c["t"], "kind": c["kind"],
                        "strength": c["strength"], "ref": c["ref"]}
                       for i, c in enumerate(cands)],
    }
    out_p = a.out or os.path.join(ROOT, "renders",
                                  f"{a.slug}.{a.brief}.intent.json")
    os.makedirs(os.path.dirname(out_p), exist_ok=True)
    with open(out_p, "w") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    print(f"{len(doc['cut_indices'])} cuts of {allowed} allowed, "
          f"{len(doc['holds'])} holds -> {os.path.relpath(out_p, ROOT)}",
          file=sys.stderr)
    print("strategy: " + doc["strategy"][:200], file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
