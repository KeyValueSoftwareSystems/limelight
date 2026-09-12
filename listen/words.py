from grid import at_beat

REST = 1.5


def bar_of(g, t, bars):
    per = g["beats_per_bar"]
    lo, hi = 1, max(1, bars)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if at_beat(g, (mid - 1) * per) <= t:
            lo = mid
        else:
            hi = mid - 1
    return lo


def seat(bar, origin, every):
    return (bar - origin) // every if every > 0 else 0


def loosest(kept, a, b):
    best, where = -1.0, None
    for i in range(1, len(kept)):
        at = kept[i]["at_s"]
        if at < a or at > b:
            continue
        gap = at - kept[i - 1]["to_s"]
        if gap > best:
            best, where = gap, i
    return where


def breaks(kept, g, origin, every, rest=REST):
    per = g["beats_per_bar"]
    beat = at_beat(g, 1) - at_beat(g, 0)
    cuts = set()
    for i in range(1, len(kept)):
        if kept[i]["at_s"] - kept[i - 1]["to_s"] > rest:
            cuts.add(i)
    seen = set()
    for w in kept:
        n = seat(w["bar"], origin, every)
        if n in seen:
            continue
        seen.add(n)
        edge = at_beat(g, (origin - 1 + n * every) * per)
        at = loosest(kept, edge - beat, edge + beat)
        if at is not None:
            cuts.add(at)
    return cuts


SHORT = 2


def phrased(kept, g, origin, every, rest=REST):
    cuts = breaks(kept, g, origin, every, rest)
    out, now = [], []
    for i, w in enumerate(kept):
        if now and i in cuts:
            out.append(now)
            now = []
        now.append(w)
    if now:
        out.append(now)
    return glued(out, rest)


def glued(rows, rest):
    out = []
    for line in rows:
        if (out and len(out[-1]) <= SHORT
                and line[0]["at_s"] - out[-1][-1]["to_s"] <= rest):
            out[-1].extend(line)
            continue
        out.append(line)
    return out


SLACK = 1.2


def plain(s):
    return "".join(c for c in s.lower() if c.isalnum())


def confirmed(kept, again, slack=SLACK):
    other = [(plain(w.get("text", "")), float(w["at_s"])) for w in (again or [])]
    for w in kept:
        want = plain(w["text"])
        w["heard_twice"] = any(text == want and abs(at - w["at_s"]) <= slack
                               for text, at in other)
    return kept


def words(got, g, bars, origin=1, every=4, again=None):
    said = got.get("said") or []
    kept = []
    for w in said:
        text = str(w.get("text", "")).strip()
        if not text:
            continue
        kept.append({"text": text,
                     "at_s": round(float(w["at_s"]), 3),
                     "to_s": round(float(w["to_s"]), 3),
                     "bar": bar_of(g, float(w["at_s"]), bars)})
    if not kept:
        return None
    twice = again is not None
    if twice:
        confirmed(kept, again)
    rows = []
    for line in phrased(kept, g, origin, every):
        row = {"at_s": line[0]["at_s"], "to_s": line[-1]["to_s"],
               "from_bar": line[0]["bar"], "to_bar": line[-1]["bar"],
               "text": " ".join(w["text"] for w in line)}
        if twice:
            row["sure"] = round(sum(1 for w in line if w["heard_twice"]) / len(line), 2)
        rows.append(row)
    out = {"language": got.get("language"),
           "sung_in": "phrases of the song's own grid",
           "checked_twice": twice, "words": kept, "lines": rows}
    if twice:
        out["sure"] = round(sum(1 for w in kept if w["heard_twice"]) / len(kept), 3)
    return out
