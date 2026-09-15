#!/usr/bin/env python3
import json, os, re, sys, glob

SAME = {
    "inst": "instrumental",
    "inst.": "instrumental",
    "pre chorus": "pre-chorus",
    "prechorus": "pre-chorus",
    "post chorus": "post-chorus",
    "postchorus": "post-chorus",
    "break": "breakdown",
    "build-up": "buildup",
    "build up": "buildup",
}


def norm(label):
    """SongFormer writes `inst` where MOSS writes `instrumental`.

    Comparing the raw strings counted 48 of those as the two models
    disagreeing, and dragged the reported label agreement from 0.75 to 0.56."""
    if not label:
        return ""
    label = re.sub(r"\s*\d+$", "", str(label).strip().lower())
    return SAME.get(label, label)


def agree(mine, theirs, slack=2.0):
    out = []
    for s in mine:
        near = [t for t in theirs if abs(t["start"] - s["start"]) <= slack]
        row = dict(s)
        if near:
            best = min(near, key=lambda t: abs(t["start"] - s["start"]))
            row["also_heard"] = {
                "at": round(best["start"], 3),
                "off_s": round(abs(best["start"] - s["start"]), 3),
                "label": best["label"],
                "same_label": norm(best["label"]) == norm(s.get("label")),
            }
        else:
            row["also_heard"] = None
        out.append(row)
    return out


def fold_unheard(sections):
    out = []
    for s in sections:
        alone = not isinstance(s.get("also_heard"), dict)
        if out and alone and norm(out[-1].get("label")) == norm(s.get("label")):
            out[-1] = {**out[-1], "end": s["end"]}
            continue
        out.append(dict(s))
    return out


def main(scores_dir, sf_dir):
    touched = 0
    for p in sorted(glob.glob(os.path.join(scores_dir, "*.score"))):
        slug = os.path.basename(p)[:-6]
        sf = os.path.join(sf_dir, slug + ".json")
        if not os.path.exists(sf):
            continue
        d = json.load(open(p))
        if not d.get("sections"):
            continue
        theirs = json.load(open(sf))
        d["sections"] = fold_unheard(agree(d["sections"], theirs))
        d["sections_second_opinion"] = {
            "from": "SongFormer (ASLP-lab), 7-class functional segmentation",
            "why": "trained on different data, shares no code with MOSS; "
            "a boundary both models place is worth more than either alone",
            "segments": theirs,
        }
        hit = sum(1 for s in d["sections"] if s.get("also_heard"))
        same = sum(
            1
            for s in d["sections"]
            if s.get("also_heard") and s["also_heard"]["same_label"]
        )
        d["sections_second_opinion"]["agreed_boundaries"] = (
            f"{hit} of {len(d['sections'])}"
        )
        d["sections_second_opinion"]["agreed_labels"] = (
            f"{same} of {hit}" if hit else "0 of 0"
        )
        json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
        touched += 1
        print(
            "  %-26s boundaries %2d/%-2d  labels %2d/%-2d"
            % (slug, hit, len(d["sections"]), same, hit)
        )
    print("merged into %d scores" % touched)


if __name__ == "__main__":
    main(
        sys.argv[1] if len(sys.argv) > 1 else "scores",
        sys.argv[2] if len(sys.argv) > 2 else "songformer-out",
    )
