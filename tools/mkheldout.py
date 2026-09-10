#!/usr/bin/env python3
"""Full-length Creative Commons recordings nobody here has tuned against.

    python3 tools/mkheldout.py --n 12 --dest synth/incoming/heldout

WHY. The five recordings in synth/maps/amal have had the scorer, the weights and
half the fields designed while someone was looking at them. Every number this
project reports on those five is therefore a number reported on its own training
set. That was acceptable while the map was the only product. It is not
acceptable for a claim about a system that edits video, because the claim is
about music in general.

So these tracks are HELD OUT, and held out means something specific and
enforceable: no threshold, weight, tolerance or feature may be changed after
looking at how they score. If one of them exposes a bug, the fix is a fix and it
is recorded as one -- but tuning a constant until these look better is the
overfitting this file exists to escape, and it would be undetectable later.

LICENCE. The allow-list below permits derivative works. That is not paperwork:
cutting video to a track produces a synchronised audiovisual work, which is a
derivative, so a NoDerivatives track cannot lawfully be used for the one thing
we want it for. ND is excluded by construction rather than by intention, and
anything whose licence field is absent or unrecognised is skipped rather than
assumed permissive.

FULL LENGTH, not excerpts. listen/percentile.py had to keep arrangement features
null because FMA-small ships 30-second clips, and drops-per-minute cannot be
measured on half a minute. These are whole recordings, so structure, spans and
arrangement are all answerable here.
"""
import argparse, json, os, sys, subprocess, hashlib, urllib.request, urllib.parse, random, re

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "Mozilla/5.0 (X11; Linux x86_64) limelight-heldout/1.0"
SEARCH = "https://archive.org/advancedsearch.php"

# Licences that permit derivative works. BY and BY-SA require attribution, which
# the catalogue carries. CC0 and the public-domain mark require nothing.
ALLOW = [
    "http://creativecommons.org/licenses/by/3.0/",
    "http://creativecommons.org/licenses/by/4.0/",
    "https://creativecommons.org/licenses/by/4.0/",
    "http://creativecommons.org/licenses/by-sa/3.0/",
    "http://creativecommons.org/licenses/by-sa/4.0/",
    "https://creativecommons.org/licenses/by-sa/4.0/",
    "http://creativecommons.org/publicdomain/zero/1.0/",
    "https://creativecommons.org/publicdomain/zero/1.0/",
    "http://creativecommons.org/publicdomain/mark/1.0/",
]
# Named so a reader can see the exclusion is deliberate, not an oversight.
REFUSED_BECAUSE_NO_DERIVATIVES = ("-nd/", "-nc-nd/")

MIN_S, MAX_S = 90.0, 420.0


def get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def search(licence, rows=60):
    q = f'collection:netlabels AND mediatype:audio AND licenseurl:"{licence}"'
    qs = urllib.parse.urlencode(
        [("q", q), ("rows", rows), ("output", "json"),
         ("fl[]", "identifier"), ("fl[]", "title"),
         ("fl[]", "creator"), ("fl[]", "licenseurl")])
    try:
        d = json.loads(get(f"{SEARCH}?{qs}"))
    except Exception as e:
        print(f"  search failed for {licence}: {e}", file=sys.stderr)
        return []
    return d["response"]["docs"]


def slugify(s):
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s[:48] or "untitled"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=12)
    ap.add_argument("--dest", default="synth/incoming/heldout")
    ap.add_argument("--seed", type=int, default=20260910)
    a = ap.parse_args()
    os.makedirs(a.dest, exist_ok=True)

    docs = []
    for lic in ALLOW:
        docs += [d for d in search(lic) if d.get("licenseurl") in ALLOW]
    # One entry per archive item; shuffle so the set is not one netlabel's taste.
    by_id = {}
    for d in docs:
        by_id.setdefault(d["identifier"], d)
    items = sorted(by_id.values(), key=lambda d: d["identifier"])
    random.Random(a.seed).shuffle(items)
    print(f"{len(items)} candidate items", file=sys.stderr)

    out, seen_creators = [], {}
    for it in items:
        if len(out) >= a.n:
            break
        ident = it["identifier"]
        try:
            meta = json.loads(get(f"https://archive.org/metadata/{ident}"))
        except Exception:
            continue
        files = [f for f in meta.get("files", [])
                 if f.get("format") == "VBR MP3" and f.get("length")]
        if not files:
            continue

        def secs(f):
            v = f["length"]
            if ":" in str(v):
                p = [float(x) for x in str(v).split(":")]
                return sum(x * 60 ** i for i, x in enumerate(reversed(p)))
            return float(v)

        cands = [f for f in files if MIN_S <= secs(f) <= MAX_S]
        if not cands:
            continue
        # One track per release, and at most two per artist, so the held-out set
        # is not four songs by one person wearing four filenames.
        creator = str(it.get("creator") or ident)
        if seen_creators.get(creator, 0) >= 2:
            continue
        f = cands[len(cands) // 2]
        slug = f"{slugify(creator)}--{slugify(os.path.splitext(f['name'])[0])}"[:70]
        dst = os.path.join(a.dest, slug + ".mp3")
        url = f"https://archive.org/download/{ident}/{urllib.parse.quote(f['name'])}"
        if not os.path.exists(dst):
            try:
                data = get(url, timeout=180)
            except Exception as e:
                print(f"  {ident}: download failed {e}", file=sys.stderr)
                continue
            with open(dst, "wb") as fh:
                fh.write(data)
        seen_creators[creator] = seen_creators.get(creator, 0) + 1
        out.append({
            "slug": slug,
            "file": dst,
            "title": f.get("title") or f["name"],
            "creator": creator,
            "album": it.get("title"),
            "archive_identifier": ident,
            "source_url": url,
            "item_url": f"https://archive.org/details/{ident}",
            "licence": it["licenseurl"],
            "duration_s": round(secs(f), 3),
            "bytes": os.path.getsize(dst),
            "sha256": hashlib.sha256(open(dst, "rb").read()).hexdigest(),
        })
        print(f"  [{len(out)}/{a.n}] {slug} ({secs(f):.0f}s)", file=sys.stderr)

    # The catalogue goes somewhere TRACKED, not next to the audio: synth/incoming
    # is gitignored (rule 1), and a catalogue that lives inside the ignored
    # folder is a catalogue nobody else can fetch the set from.
    cat = os.path.join(os.path.dirname(HERE), "songs", "heldout", "HELDOUT.json")
    os.makedirs(os.path.dirname(cat), exist_ok=True)
    with open(cat, "w") as fh:
        json.dump({
            "note": ("Full-length CC recordings held out from every tuning "
                     "decision in this repo. Audio is gitignored; this file "
                     "makes the set reproducible."),
            "made_by": {"how": "fetched", "who": "tools/mkheldout.py"},
            "licences_allowed": ALLOW,
            "licences_refused": {
                "patterns": list(REFUSED_BECAUSE_NO_DERIVATIVES),
                "why": ("A video edit cut to a track is a synchronised "
                        "audiovisual derivative. NoDerivatives forbids it."),
            },
            "held_out_means": ("No threshold, weight, tolerance or feature in "
                               "this repo may be changed after seeing how these "
                               "score. Bugs may be fixed; constants may not be "
                               "tuned."),
            "seed": a.seed,
            "tracks": out,
        }, fh, indent=1)
        fh.write("\n")
    print(f"{len(out)} tracks -> {cat}", file=sys.stderr)


if __name__ == "__main__":
    main()
