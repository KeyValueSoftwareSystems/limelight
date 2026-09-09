#!/usr/bin/env python3
"""The learned tier moves out of the map, into a file named after what made it.

    python3 listen/sidecar.py [slug ...] [--write]

Three things were wrong with `vectors` living in the map.

A 777 KB block of float16 does not belong in a file a person opens to read what
a song does, and the map is JSON, so it was never in the map anyway -- it was
already a sidecar, referenced by a name that said nothing about which model or
which revision produced it. `levels.vec.f16` is unfalsifiable: two runs against
two different checkpoints write the same filename and the second silently wins.
The name now carries the model and the revision, so a file made by a different
checkpoint cannot occupy the same path.

`vectors.section_similarity` was 105 to 500 numbers derived entirely from the
sidecar and `sections`. A reader can compute it; it does not go in the map.
`identity` replaces it in a form that says something the pair table did not.

And the reference was dangling. the-nights' map pointed at a file that is not
there, and nothing noticed, because nothing checked. This writes rows, dim,
bytes and a sha256, and refuses to write a reference to a file it cannot read
and measure.

The revision is the snapshot hash of the local huggingface cache the vectors
were actually made from -- measured, not stated. If the cache is gone the field
says so rather than guessing a version.
"""
import sys, os, json, hashlib, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from mapio import map_path

HF = os.path.expanduser("~/.cache/huggingface/hub")
WIDTH = {"float16": 2, "float32": 4}
EXT = {"float16": "f16", "float32": "f32"}


def revision(model):
    """The commit this machine actually holds for that model, or None."""
    d = os.path.join(HF, "models--" + model.replace("/", "--"), "refs", "main")
    if os.path.exists(d):
        r = open(d).read().strip()
        if r:
            return r
    snaps = glob.glob(os.path.join(HF, "models--" + model.replace("/", "--"), "snapshots", "*"))
    return os.path.basename(snaps[0]) if len(snaps) == 1 else None


def slugify(model):
    return model.split("/")[-1].lower().replace("_", "-")


def canonical(slug, model, rev, rate, dtype):
    return "%s.%s%s.%s.%s" % (
        slug, slugify(model),
        "-" + rev[:12] if rev else "-unpinned",
        rate.replace("_", "-"), EXT.get(dtype, dtype),
    )


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


REF_NOTE = (
    "a reference, not the data. The vectors are in the file named here, beside this map. "
    "The name carries the model and the revision that produced it so a different checkpoint "
    "cannot overwrite it, and the sha256 and byte count are measured from the file on disk so "
    "a reference that has gone stale can be caught instead of trusted."
)
HOW_TO_READ = (
    "numpy.fromfile(file, dtype='<f2').reshape(rows, dim); row i is beat i of `beats`, "
    "L2-normalised, so a dot product between two rows is a cosine"
)


def analyse(slug, write=False):
    mp = map_path(slug)
    if not mp:
        return {"error": "no map"}
    m = json.load(open(mp))
    v = m.get("vectors")
    if not isinstance(v, dict):
        return {"slug": slug, "state": "no vectors field"}

    model = v.get("model") or "?"
    rate = v.get("rate") or "per_beat"
    dtype = v.get("dtype") or "float16"
    rev = revision(model)
    d = os.path.dirname(mp)
    old = v.get("file")
    want = canonical(slug, model, rev, rate, dtype)

    have = None
    for cand in ([want] if want else []) + ([old] if old else []):
        if cand and os.path.exists(os.path.join(d, cand)):
            have = cand
            break

    if have is None:
        # A reference nobody can follow is worse than no reference: a reader
        # cannot tell it from a working one. Say what is missing instead.
        ref = {
            "model": model, "revision": rev, "rate": rate, "dim": v.get("dim"),
            "rows": v.get("rows"), "dtype": dtype, "layout": v.get("layout", "row_major"),
            "file": None,
            "unavailable": "the sidecar this map used to name (%s) is not on disk. It was not "
                           "kept in git -- rebuild it with listen/vectors.py -- and the "
                           "reference is null rather than pointing at a file that is not there."
                           % (old or "?"),
            "pooling": v.get("pooling"), "not": v.get("not"), "device": v.get("device"),
            "provenance": "measured (absence checked on disk)",
            "note": REF_NOTE, "how_to_read": HOW_TO_READ,
        }
        m["vectors"] = ref
        if write:
            json.dump(m, open(mp, "w"), indent=1, ensure_ascii=False)
            open(mp, "a").write("\n")
        return {"slug": slug, "state": "missing", "old": old, "want": want, "wrote": write}

    src = os.path.join(d, have)
    nbytes = os.path.getsize(src)
    dim = v.get("dim")
    w = WIDTH.get(dtype)
    rows_from_bytes = nbytes // (dim * w) if dim and w else None
    beats = len(m.get("beats") or [])

    if have != want and write:
        os.rename(src, os.path.join(d, want))
        src = os.path.join(d, want)

    problems = []
    if rows_from_bytes is not None and v.get("rows") not in (None, rows_from_bytes):
        problems.append("map says %s rows, the file holds %s" % (v.get("rows"), rows_from_bytes))
    if dim and w and nbytes % (dim * w):
        problems.append("%d bytes is not a whole number of %d-wide rows of %d" % (nbytes, w, dim))
    if rows_from_bytes is not None and beats and rows_from_bytes != beats:
        problems.append("%s rows against %d beats, and the rate is per_beat"
                        % (rows_from_bytes, beats))

    ref = {
        "model": model,
        "revision": rev,
        "revision_provenance": (
            "measured -- the commit this machine's huggingface cache holds for that model"
            if rev else "unknown -- no local cache entry, so no version is claimed"),
        "layer": v.get("layer", "last_hidden_state"),
        "rate": rate,
        "rows": rows_from_bytes if rows_from_bytes is not None else v.get("rows"),
        "dim": dim,
        "dtype": dtype,
        "layout": v.get("layout", "row_major"),
        "file": want if write else have,
        "bytes": nbytes,
        "sha256": sha256(src),
        "provenance": "measured -- rows, bytes and sha256 read off the file on disk",
        "pooling": v.get("pooling"),
        "not": v.get("not"),
        "device": v.get("device"),
        "note": REF_NOTE,
        "how_to_read": HOW_TO_READ,
    }
    if problems:
        ref["disagrees_with_the_file"] = problems
    m["vectors"] = ref
    if write:
        json.dump(m, open(mp, "w"), indent=1, ensure_ascii=False)
        open(mp, "a").write("\n")
    return {"slug": slug, "state": "ok" if not problems else "mismatch", "file": ref["file"],
            "rows": ref["rows"], "dim": dim, "bytes": nbytes, "rev": rev,
            "renamed": have != want, "problems": problems,
            "dropped_similarity": len(v.get("section_similarity") or {}), "wrote": write}


def check(slug):
    """Independent of the writer above: follow the reference and see if it holds."""
    mp = map_path(slug)
    if not mp:
        return ["no map"]
    m = json.load(open(mp))
    v = m.get("vectors")
    if not isinstance(v, dict):
        return []
    if v.get("file") is None:
        return [] if v.get("unavailable") else ["no file and no reason given"]
    p = os.path.join(os.path.dirname(mp), v["file"])
    if not os.path.exists(p):
        return ["names %s, which is not on disk" % v["file"]]
    errs = []
    if os.path.getsize(p) != v.get("bytes"):
        errs.append("claims %s bytes, file is %d" % (v.get("bytes"), os.path.getsize(p)))
    if sha256(p) != v.get("sha256"):
        errs.append("sha256 does not match the file")
    w = WIDTH.get(v.get("dtype"), 0)
    if w and v.get("dim") and os.path.getsize(p) != v["rows"] * v["dim"] * w:
        errs.append("%d x %d x %d bytes does not equal the file size"
                    % (v["rows"], v["dim"], w))
    rev = v.get("revision")
    if rev and v["file"].find(rev[:12]) < 0:
        errs.append("the filename does not carry the revision it claims")
    return errs


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    slugs = args or ["levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"]
    bad = 0
    for slug in slugs:
        r = analyse(slug, write)
        if r.get("state") == "missing":
            print("  %-16s NO SIDECAR -- reference set to null, rebuild with listen/vectors.py"
                  % slug)
        elif "error" in r or r.get("state") == "no vectors field":
            print("  %-16s %s" % (slug, r.get("error") or r["state"]))
        else:
            print("  %-16s %s  %d x %d  %d KB%s%s"
                  % (slug, r["file"], r["rows"], r["dim"], r["bytes"] // 1024,
                     "  renamed" if r["renamed"] else "",
                     "  dropped %d derived similarity pairs" % r["dropped_similarity"]
                     if r["dropped_similarity"] else ""))
            for p in r["problems"]:
                print("  %-16s   MISMATCH: %s" % ("", p))
        errs = check(slug)
        for e in errs:
            bad += 1
            print("  %-16s   CHECK FAILED: %s" % ("", e))
    sys.exit(1 if bad else 0)
