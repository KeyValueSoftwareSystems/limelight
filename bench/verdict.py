#!/usr/bin/env python3
"""A blind A/B/C between edits, and the human verdict that is the actual answer.

    python3 bench/verdict.py new    --slug levels --brief premium-restraint
    python3 bench/verdict.py record --token 7f3a --best B --worst A --who amal \
                                    --note "B holds through the break"

WHY BLIND. bench/cutscore.py measures whether the picture moves when the sound
does. It cannot measure whether an edit is any good, and it is actively
misleading if read that way: cutting on every single beat maximises alignment and
is the thing this whole lane argues against. So the ranking authority is a
person, and a person who knows which file the system is proud of is not a
reliable instrument.

`new` renders the candidates to A.mp4, B.mp4, C.mp4 in a shuffled order, writes
the mapping to a dotfile beside them, and prints nothing that gives it away. The
mapping is revealed by `record`, AFTER the verdict is written down -- not before,
and not by reading the folder, which is why the letters are assigned by a hash of
the token rather than by the order the policies happen to be listed in.

WHY NOT AUTOMATED. AGENTS.md is explicit that a file labelled `how: truth` is a
human with the material playing, and that an agent must never write one. This
tool does not invent a verdict; it records one that a person typed, and it stamps
`who` with the name that person gave. If nobody has run `record`, the verdict
file says so, and every claim about which edit is better stays unsupported.
"""
import argparse, json, os, hashlib, random, shutil, subprocess, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BLIND = os.path.join(ROOT, "renders", "blind")
VERDICTS = os.path.join(ROOT, "truth", "video-verdicts.json")
LETTERS = "ABCDEF"


def token_for(slug, brief, policies):
    return hashlib.sha1(("|".join([slug, brief] + sorted(policies))).encode()
                        ).hexdigest()[:4]


def cmd_variants(a):
    """Rank N briefs that differ on ONE word each.

    The A/B/C above compares POLICIES -- different ways of deciding, same
    taste. This compares TASTE: same policy, same song, same footage, and one
    word of the recipe changed. "Which do you prefer" is only answerable if
    exactly one thing moved, which is why the ad-* briefs are generated from a
    base with a single substitution rather than written by hand.

    Still blind, for the same reason: a person who can see that D is the one
    with the effects turned up is not ranking the film any more.
    """
    names = [x.strip() for x in a.variants.split(",") if x.strip()]
    if len(names) < 2 or len(names) > len(LETTERS):
        print(f"give 2..{len(LETTERS)} briefs", file=sys.stderr); return 1
    token = hashlib.sha1(("|".join([a.slug] + sorted(names))).encode()).hexdigest()[:4]
    d = os.path.join(BLIND, token)
    os.makedirs(d, exist_ok=True)

    order = names[:]
    random.Random(int(token, 16)).shuffle(order)

    py = os.path.join(ROOT, "work", "vision", "bin", "python")
    if not os.path.exists(py):
        py = sys.executable

    mapping = {}
    for i, brief in enumerate(order):
        ir = os.path.join(d, f".{brief}.ir.json")
        cmd = ["node", os.path.join(ROOT, "readers", "video", "edit.js"),
               "--slug", a.slug, "--brief", brief, "--policy", a.policy,
               "--out", ir]
        if a.set: cmd += ["--set", a.set]
        if a.window: cmd += ["--window", str(a.window)]
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"edit failed for {brief}: {r.stderr[-400:]}", file=sys.stderr); return 1
        out = os.path.join(d, LETTERS[i] + ".mp4")
        r = subprocess.run([py, os.path.join(ROOT, "readers", "video", "render.py"),
                            ir, "--out", out], cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            print(f"render failed for {brief}: {r.stderr[-400:]}", file=sys.stderr); return 1
        mapping[LETTERS[i]] = brief
        print(f"  {LETTERS[i]}.mp4  ok")

    # Refuse to ask for a preference between two identical files. Three of the
    # first six candidates shared an md5, because the effects word never
    # reached the renderer -- and a ranking collected over that would have been
    # recorded as a human verdict and believed. A word that cannot change the
    # output is a word the writer should be told saturated, not one to quietly
    # put on screen twice.
    import hashlib as _h
    seen = {}
    for L, brief in mapping.items():
        h = _h.md5(open(os.path.join(d, L + ".mp4"), "rb").read()).hexdigest()
        if h in seen:
            print(f"\nREFUSING to seal: {brief} and {seen[h]} rendered byte-identical "
                  f"files.\nThe word that differs between them made no difference to "
                  f"this song -- either it is inert, or the material saturates it "
                  f"(a 20 s window with 2 moments cannot tell 4 effects/min from 9).\n"
                  f"Pick axes that actually move, or say so and drop one.",
                  file=sys.stderr)
            return 1
        seen[h] = brief

    with open(os.path.join(d, ".sealed.json"), "w") as f:
        json.dump({"slug": a.slug, "brief": "|".join(sorted(names)),
                   "kind": "variants", "policy": a.policy, "mapping": mapping,
                   "sealed_at": datetime.datetime.now().isoformat(timespec="seconds")},
                  f, indent=1)

    print(f"\ntoken {token}")
    print(f"watch: {d}")
    print("\nSame song, same footage, same policy. One word of the recipe differs")
    print("between them. Rank them best to worst -- and say what you are ranking")
    print("ON, because that is the part no measurement can supply.")
    print(f"\n  python3 bench/verdict.py record --token {token} \\")
    print(f"      --rank <letters, best first> --who <name> --note '...'")
    return 0


def cmd_new(a):
    policies = a.policy or ["naive", "random", "rules"]
    token = token_for(a.slug, a.brief, policies)
    d = os.path.join(BLIND, token)
    os.makedirs(d, exist_ok=True)

    # Letters assigned by a hash of the token, not by the order above, so that
    # "the last one listed is the good one" is never true.
    order = policies[:]
    random.Random(int(token, 16)).shuffle(order)

    mapping = {}
    for i, pol in enumerate(order):
        ir = os.path.join(ROOT, "renders",
                          f"{a.slug}.{a.brief}.{pol}.ir.json")
        if not os.path.exists(ir):
            r = subprocess.run(
                ["node", os.path.join(ROOT, "readers", "video", "edit.js"),
                 "--slug", a.slug, "--brief", a.brief, "--policy", pol,
                 "--out", os.path.relpath(ir, ROOT)],
                cwd=ROOT, capture_output=True, text=True)
            if r.returncode != 0:
                print(f"edit failed for {pol}: {r.stderr[:300]}", file=sys.stderr)
                return 1
        out = os.path.join(d, LETTERS[i] + ".mp4")
        if not os.path.exists(out) or a.force:
            r = subprocess.run(
                [sys.executable, os.path.join(ROOT, "readers", "video", "compile.py"),
                 ir, "--out", out] + (["--preview"] if a.preview else []),
                cwd=ROOT, capture_output=True, text=True)
            if r.returncode != 0:
                print(f"compile failed for {pol}: {r.stderr[:400]}", file=sys.stderr)
                return 1
        mapping[LETTERS[i]] = pol

    with open(os.path.join(d, ".sealed.json"), "w") as f:
        json.dump({"slug": a.slug, "brief": a.brief, "mapping": mapping,
                   "sealed_at": datetime.datetime.now().isoformat(timespec="seconds")},
                  f, indent=1)

    print(f"token {token}")
    print(f"watch, in any order: {d}")
    for L in sorted(mapping):
        print(f"   {L}.mp4")
    print()
    print("Same song, same clips, same brief. Only the decision process differs.")
    print("Which holds your attention, and which feels like it is cutting for")
    print("the sake of cutting?")
    print()
    print(f"  python3 bench/verdict.py record --token {token} \\")
    print(f"      --best <letter> --worst <letter> --who <your name> --note '...'")
    print()
    print("The mapping is sealed until then. Do not read .sealed.json first;")
    print("the whole value of the answer is that it was given without it.")
    return 0


def cmd_record(a):
    d = os.path.join(BLIND, a.token)
    sealed_p = os.path.join(d, ".sealed.json")
    if not os.path.exists(sealed_p):
        print(f"no sealed run for token {a.token}", file=sys.stderr)
        return 1
    sealed = json.load(open(sealed_p))
    mapping = sealed["mapping"]
    if a.reject_all:
        a.best = a.worst = None
    elif not a.best:
        print("--best is required unless --reject-all", file=sys.stderr)
        return 1
    for L in (a.best, a.worst):
        if L and L not in mapping:
            print(f"{L} is not one of {sorted(mapping)}", file=sys.stderr)
            return 1

    rank = None
    if getattr(a, "rank", None):
        rank = [c for c in a.rank.upper() if c in LETTERS]
        bad = [c for c in rank if c not in mapping]
        if bad:
            print(f"{bad} not among {sorted(mapping)}", file=sys.stderr); return 1
        if len(set(rank)) != len(mapping):
            print(f"rank every one of {sorted(mapping)}, best first", file=sys.stderr); return 1
        a.best, a.worst = rank[0], rank[-1]

    rec = {
        "at": datetime.datetime.now().isoformat(timespec="seconds"),
        "token": a.token,
        "kind": sealed.get("kind", "policies"),
        "rank_letters": rank,
        "rank": [mapping[c] for c in rank] if rank else None,
        "slug": sealed["slug"], "brief": sealed["brief"],
        "who": a.who,
        "how": "truth",
        "blind": True,
        "rejected_all": bool(a.reject_all),
        "best_letter": a.best, "worst_letter": a.worst,
        "best_policy": mapping.get(a.best), "worst_policy": mapping.get(a.worst),
        "note": a.note or "",
        "mapping": mapping,
    }
    os.makedirs(os.path.dirname(VERDICTS), exist_ok=True)
    doc = {"note": ("Human verdicts on blind A/B/C comparisons between video "
                    "policies. `how: truth` here means a person watched the "
                    "files and typed the answer -- nothing in this file was "
                    "produced by a model."),
           "protocol": "bench/verdict.py, letters sealed until record",
           "verdicts": []}
    if os.path.exists(VERDICTS):
        doc = json.load(open(VERDICTS))
    doc.setdefault("verdicts", []).append(rec)
    with open(VERDICTS, "w") as f:
        json.dump(doc, f, indent=1)
        f.write("\n")
    if a.reject_all:
        print("recorded: ALL REJECTED -- no policy produced an acceptable edit")
    else:
        print(f"recorded: best={a.best} ({mapping.get(a.best)}), "
              f"worst={a.worst} ({mapping.get(a.worst)})")
    print(f"-> {os.path.relpath(VERDICTS, ROOT)}")
    print()
    print("full mapping: " + ", ".join(f"{k}={v}" for k, v in sorted(mapping.items())))
    return 0


def cmd_show(a):
    if not os.path.exists(VERDICTS):
        print("no verdicts recorded yet. Every claim that one policy beats")
        print("another is unsupported until somebody runs bench/verdict.py.")
        return 0
    doc = json.load(open(VERDICTS))
    vs = doc.get("verdicts", [])
    print(f"{len(vs)} verdict(s)")
    tally = {}
    for v in vs:
        if v.get("rejected_all"):
            print(f"  {v['at']}  {v['slug']}/{v['brief']}  ALL REJECTED  ({v['who']})")
        else:
            print(f"  {v['at']}  {v['slug']}/{v['brief']}  best={v['best_policy']}"
                  f"  worst={v['worst_policy']}  ({v['who']})")
        if v.get("note"):
            print(f"      \"{v['note']}\"")
        if v.get("best_policy"):
            tally[v["best_policy"]] = tally.get(v["best_policy"], 0) + 1
    if tally:
        print()
        print("preferred: " + ", ".join(f"{k} x{v}" for k, v in
                                        sorted(tally.items(), key=lambda x: -x[1])))
        print(f"n = {len(vs)}. Small n is small n; this is a recorded opinion,")
        print("not a significance test.")
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new")
    n.add_argument("--slug", required=True)
    n.add_argument("--brief", default="premium-restraint")
    n.add_argument("--policy", action="append")
    n.add_argument("--preview", action="store_true")
    n.add_argument("--force", action="store_true")
    n.set_defaults(fn=cmd_new)
    v = sub.add_parser("variants")
    v.add_argument("--slug", required=True)
    v.add_argument("--variants", required=True,
                   help="comma-separated brief ids differing in one word each")
    v.add_argument("--policy", default="rules")
    v.add_argument("--set", default=None)
    v.add_argument("--window", type=float, default=None)
    v.set_defaults(fn=cmd_variants)

    r = sub.add_parser("record")
    r.add_argument("--token", required=True)
    r.add_argument("--reject-all", action="store_true",
                   help="None of them are acceptable. A more important verdict "
                        "than a ranking, and the tool could not express it "
                        "until a person needed to.")
    r.add_argument("--rank", help="every letter, best first, e.g. DBACEF")
    r.add_argument("--best")
    r.add_argument("--worst")
    r.add_argument("--who", required=True)
    r.add_argument("--note")
    r.set_defaults(fn=cmd_record)
    s = sub.add_parser("show")
    s.set_defaults(fn=cmd_show)
    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
