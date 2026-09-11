#!/usr/bin/env python3
"""Which pile of footage does this brief mean?

    python3 assets/match.py --brief ad-minimal

WHY THIS EXISTS. A brief is supposed to be the words a person says. `--set
product` is not one of those words -- it is the name of a folder, and asking a
writer to know it is the same leak as asking them for cuts_per_minute. The
brief says "A phone ad"; which footage that means is a question with a measured
answer, so the system should answer it.

HOW. assets/stock/*/SEMANTIC.json already stores, for every shot, its cosine
against all 37 words of the content vocabulary. Averaged over a set, that is a
37-number signature of what the set is OF -- computed from measurements already
on disk, with no model and no new pass over the video.

The brief's own words are the only thing that needs the model, and only its text
encoder: one forward pass over a sentence. The brief is embedded, compared to
the same 37 words, and the set whose signature agrees most is the answer.

WHAT IT IS NOT. It does not decide whether footage is GOOD, only what it is of.
A set can win here and still be the wrong choice for the film, which is why the
answer is printed with its evidence rather than applied silently.
"""
import argparse, json, os, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def profiles():
    """Each set's mean cosine per vocabulary word. Stored data only."""
    out = {}
    for p in sorted(glob.glob(os.path.join(ROOT, "assets", "stock", "*", "SEMANTIC.json"))):
        setn = os.path.basename(os.path.dirname(p))
        try:
            sm = json.load(open(p))
        except Exception:
            continue
        rows = sm.get("shots") or []
        if not rows:
            continue
        acc, n = {}, 0
        for r in rows:
            c = r.get("content") or {}
            if not c:
                continue
            n += 1
            for w, v in c.items():
                acc[w] = acc.get(w, 0.0) + v
        if not n:
            continue
        out[setn] = ({w: v / n for w, v in acc.items()}, n)
    return out


def brief_words(brief):
    """Everything in the brief a person actually wrote that describes content."""
    bits = []
    for k in ("name", "subject_note", "note"):
        if isinstance(brief.get(k), str):
            bits.append(brief[k])
    subj = brief.get("subject")
    if isinstance(subj, list):
        bits.extend([s for s in subj if isinstance(s, str)])
    # The name carries the intent and is the part a three-line brief has.
    return bits[:1] if not subj else [bits[0]] + [s for s in subj if isinstance(s, str)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brief", required=True)
    ap.add_argument("--top", type=int, default=3)
    ap.add_argument("--quiet", action="store_true", help="print only the winning set")
    a = ap.parse_args()

    bp = os.path.join(ROOT, "briefs", a.brief + ".json")
    if not os.path.exists(bp):
        print(f"no brief at {bp}", file=sys.stderr); return 2
    brief = json.load(open(bp))
    words = brief_words(brief)
    if not words:
        print("the brief says nothing about content", file=sys.stderr); return 2

    prof = profiles()
    if not prof:
        print("no SEMANTIC.json anywhere -- run assets/semantic.py first", file=sys.stderr)
        return 2
    vocab = sorted(next(iter(prof.values()))[0].keys())

    import torch
    from transformers import CLIPModel, CLIPProcessor
    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").eval()
    proc = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    with torch.no_grad():
        t = proc(text=words + vocab, return_tensors="pt", padding=True)
        v = model.get_text_features(**t)
    v = v / v.norm(dim=-1, keepdim=True)
    q = v[:len(words)].mean(0)
    q = q / q.norm()
    sim = (v[len(words):] @ q).tolist()

    # The brief's affinity for each vocabulary word, as a distribution. Absolute
    # CLIP cosines sit in a narrow band and mean nothing on their own, so this
    # is centred: what the brief wants MORE than an average sentence would.
    mean = sum(sim) / len(sim)
    want = {w: s - mean for w, s in zip(vocab, sim)}

    scored = []
    for setn, (p, n) in prof.items():
        pm = sum(p.values()) / len(p)
        score = sum(want[w] * (p[w] - pm) for w in vocab if w in p)
        scored.append((score, setn, n, p, pm))
    scored.sort(reverse=True)

    if a.quiet:
        print(scored[0][1]); return 0

    print(f"brief {a.brief!r} says: {words}")
    print(f"\nwhat it is asking for (vocabulary the brief leans toward):")
    for w, s in sorted(want.items(), key=lambda kv: -kv[1])[:6]:
        print(f"   {s:+.4f}  {w}")
    print(f"\n{'set':12s} {'shots':>6s} {'agreement':>10s}   strongest in that set")
    for score, setn, n, p, pm in scored[:a.top + 3]:
        # What the set HAS that the brief WANTS -- both positive. Ranking by
        # the raw product let two negatives multiply to a large positive, so a
        # phone brief was credited to "driving at night through a tunnel": a
        # word the set lacks and the brief did not ask for.
        pos = [((p[w] - pm) * want[w], w) for w in p if want[w] > 0 and p[w] > pm]
        best = sorted(pos)[-1][1] if pos else "nothing it asks for"
        print(f"{setn:12s} {n:6d} {score:10.5f}   {best}")
    print(f"\n-> {scored[0][1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
