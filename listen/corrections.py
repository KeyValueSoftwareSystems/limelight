import sys, os, json, datetime, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path

SCHEMA = {
    "required": ["at", "field", "was", "now", "why", "who"],
    "optional": ["t", "id", "confidence_after"],
}


def _id(rec):
    key = "|".join(str(rec.get(k)) for k in ("at", "field", "was", "now", "who"))
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def validate(entries):
    errs = []
    seen = set()
    for i, r in enumerate(entries):
        if not isinstance(r, dict):
            errs.append("entry %d is not an object" % i)
            continue
        for k in SCHEMA["required"]:
            if k not in r:
                errs.append("entry %d missing %r" % (i, k))
        extra = set(r) - set(SCHEMA["required"]) - set(SCHEMA["optional"])
        if extra:
            errs.append("entry %d has unknown keys %s" % (i, sorted(extra)))
        if "why" in r and not str(r["why"]).strip():
            errs.append(
                "entry %d has an empty why -- a correction without a reason teaches "
                "nothing and cannot be learned from" % i
            )
        rid = r.get("id") or _id(r)
        if rid in seen:
            errs.append("entry %d duplicates id %s" % (i, rid))
        seen.add(rid)
    return errs


def add(slug, field, was, now, why, who, t=None, write=False):
    p = map_path(slug)
    if not p:
        return {"error": "no map for " + slug}
    m = json.load(open(p))
    if not isinstance(m.get("corrections"), dict) or "entries" not in (m.get("corrections") or {}):
        r0 = ensure(slug, write=False)
        if "error" in r0:
            return r0
        m = json.load(open(p))
        ensure(slug, write=True)
        m = json.load(open(p))
    log = m["corrections"]
    log["note"] = NOTE
    log["schema"] = SCHEMA
    rec = {
        "at": datetime.datetime.now().replace(microsecond=0).isoformat(),
        "field": field,
        "was": was,
        "now": now,
        "why": why,
        "who": who,
    }
    if t is not None:
        rec["t"] = round(float(t), 3)
    rec["id"] = _id(rec)
    existing = {e.get("id") for e in log["entries"]}
    if rec["id"] in existing:
        return {"error": "this exact correction is already recorded (%s)" % rec["id"]}
    log["entries"].append(rec)
    errs = validate(log["entries"])
    if errs:
        return {"error": "schema: " + "; ".join(errs[:3])}
    if write:
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
        open(p, "a").write("\n")
    return {"added": rec, "total": len(log["entries"]), "path": p}


NOTE = (
    "Every change a human made to this file: when, which field, what it said, what it says "
    "now, and why. Not a description of the song -- a record of where we described it wrongly. "
    "It is the only field here that cannot be derived from anything else, and the only one that "
    "makes restraint, weight and latent reachable: those three need examples of human judgment "
    "overriding a measurement, and this is where those examples accumulate. Append-only. A "
    "correction is testimony, not measurement, so there is nothing to check it against -- the "
    "schema is validated strictly instead, and an entry is never rewritten or removed."
)


def ensure(slug, write=False):
    p = map_path(slug)
    if not p:
        return {"error": "no map"}
    m = json.load(open(p))
    log = m.get("corrections")
    created = False
    if not isinstance(log, dict) or "entries" not in log:
        legacy = log if isinstance(log, list) else []
        entries, imported = [], []
        for blk in legacy:
            if not isinstance(blk, dict):
                continue
            imported.append(blk)
            who = blk.get("by") or "unknown"
            when = blk.get("when") or ""
            why = blk.get("what") or "no reason recorded"
            for mv in blk.get("moved") or []:
                rec = {"at": when, "field": "moments." + str(mv.get("kind", "?")),
                       "was": mv.get("was"), "now": mv.get("now"), "why": why, "who": who}
                if mv.get("now") is not None:
                    rec["t"] = round(float(mv["now"]), 3)
                rec["id"] = _id(rec)
                entries.append(rec)
            if not (blk.get("moved") or []):
                rec = {"at": when, "field": blk.get("field", "unknown"),
                       "was": blk.get("was"), "now": blk.get("now"), "why": why, "who": who}
                rec["id"] = _id(rec)
                entries.append(rec)
        m["corrections"] = {"note": NOTE, "schema": SCHEMA, "entries": entries}
        if imported:
            # Never rewrite testimony. The original blocks stay exactly as their
            # writer left them, and the schema-shaped entries sit beside them.
            m["corrections"]["imported_verbatim"] = imported
            m["corrections"]["imported_note"] = (
                "these came from an earlier writer with a different shape (listen/resnap.py). "
                "They are reshaped into entries above and kept here untouched, because a "
                "correction is testimony and reshaping it is not the same as replacing it.")
        created = True
    else:
        log["note"] = NOTE
        log["schema"] = SCHEMA
    errs = validate(m["corrections"]["entries"])
    if errs:
        return {"error": "; ".join(errs[:3])}
    if write:
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
        open(p, "a").write("\n")
    return {
        "slug": slug,
        "created": created,
        "entries": len(m["corrections"]["entries"]),
        "path": p,
    }


if __name__ == "__main__":
    a = sys.argv[1:]
    write = "--write" in a
    a = [x for x in a if not x.startswith("--")]
    if a and a[0] == "add":
        if len(a) < 7:
            print(
                "usage: corrections.py add <slug> <field> <was> <now> <why> <who> [t] --write"
            )
            sys.exit(2)
        slug, field, was, now, why, who = a[1:7]
        t = float(a[7]) if len(a) > 7 else None
        r = add(slug, field, was, now, why, who, t, write)
        print(
            "  "
            + (
                r["error"]
                if "error" in r
                else "recorded %s on %s (%d total)%s"
                % (
                    r["added"]["field"],
                    slug,
                    r["total"],
                    "  -> written" if write else "",
                )
            )
        )
        sys.exit(1 if "error" in r else 0)
    for slug in a or ["levels", "starlight", "mizhiyoram", "dont-look-down"]:
        r = ensure(slug, write)
        print(
            "  %-16s %s"
            % (
                slug,
                r.get("error")
                or "corrections log %s, %d entries%s"
                % (
                    "created" if r["created"] else "present",
                    r["entries"],
                    "  -> written" if write else "",
                ),
            )
        )
