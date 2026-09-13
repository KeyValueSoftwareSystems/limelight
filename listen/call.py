import numpy as np

SURE = 0.45
ALIVE = 0.15
CLIMB = 0.10
WORTH = 1.3
LANES = ("drums", "bass", "vocals", "other")


def lift(x):
    x = np.asarray([v if v is not None else 0.0 for v in x], dtype=float)
    top = float(np.percentile(x, 98)) or 1.0
    return np.clip(x / top, 0.0, 1.5)


def facts(spans, bars):
    loud = lift(bars["intensity"])
    lit = lift(bars.get("brightness") or bars["intensity"])
    lane = {k: lift(bars[k]) for k in LANES}
    out = []
    for a, b, mark in spans:
        b = max(b, a + 1)
        piece = loud[a:b]
        shine = lit[a:b]
        third = max(1, len(piece) // 3)
        levels = {k: float(lane[k][a:b].mean()) for k in LANES}
        out.append({
            "from": a, "to": b, "mark": mark, "bars": b - a,
            "loud": float(piece.mean()),
            "rise": float(piece[-third:].mean() - piece[:third].mean()),
            "climb": float(shine[-third:].mean() - shine[:third].mean()),
            **levels,
            "wide": sum(1 for k in LANES if levels[k] > SURE),
        })
    return out, lane


def edge(bars, a, b, c):
    rows = [lift(bars[k]) for k in LANES] + [lift(bars["intensity"])]
    if min(b - a, c - b) < 2:
        return None
    apart, noise = [], []
    for v in rows:
        left, right = v[a:b], v[b:c]
        if not len(left) or not len(right):
            return None
        apart.append(abs(float(left.mean()) - float(right.mean())))
        noise.append(float(np.sqrt((left.var() + right.var()) / 2.0)))
    wide = float(np.mean(noise))
    if wide <= 1e-9:
        return None
    return float(np.mean(apart)) / wide


def sudden(bars, a, b, c, near=2):
    rows = [lift(bars[k]) for k in LANES] + [lift(bars["intensity"])]
    if min(b - a, c - b) < near + 1:
        return None
    local, whole = [], []
    for v in rows:
        left, right = v[a:b], v[b:c]
        if not len(left) or not len(right):
            return None
        local.append(abs(float(v[b:b + near].mean())
                         - float(v[max(a, b - near):b].mean())))
        whole.append(abs(float(right.mean()) - float(left.mean())))
    wide = float(np.mean(whole))
    if wide <= 1e-6:
        return None
    return float(np.mean(local)) / wide


def settle(got, name, bars):
    while True:
        merged = False
        for i in range(len(got) - 1):
            if name[i] != name[i + 1]:
                continue
            worth = edge(bars, got[i]["from"], got[i + 1]["from"], got[i + 1]["to"])
            if worth is None or worth >= WORTH:
                continue
            got[i]["to"] = got[i + 1]["to"]
            got[i]["bars"] = got[i]["to"] - got[i]["from"]
            got.pop(i + 1)
            name.pop(i + 1)
            merged = True
            break
        if not merged:
            return got, name


def call(spans, bars):
    got, lane = facts(spans, bars)
    if not got:
        return []
    n = len(got)
    mid = float(np.median([s["loud"] for s in got]))

    beats = float((lane["drums"] > ALIVE).mean()) >= 0.40
    sings = float((lane["vocals"] > SURE).mean()) >= 0.15

    seen = {}
    for s in got:
        seen[s["mark"]] = seen.get(s["mark"], 0) + 1
    back = {}
    for s in got:
        back.setdefault(s["mark"], []).append(s["loud"])
    loudest = max(back, key=lambda m: float(np.mean(back[m])))
    ceiling = float(np.mean(back[loudest]))
    again = [m for m in back
             if seen[m] >= 2 and float(np.mean(back[m])) >= ceiling * 0.80]
    anchor = max(again, key=lambda m: float(np.mean(back[m]))) if again else loudest
    at = [i for i, s in enumerate(got) if s["mark"] == anchor]
    strong = float(np.mean([got[i]["loud"] for i in at]))
    broad = float(np.mean([got[i]["wide"] for i in at]))

    first, last = at[0], at[-1]
    before = got[first - 1] if first > 0 else None
    waited = before is not None and (before["loud"] < strong * 0.85
                                     or before["rise"] > 0.08)
    hook = float(np.mean([got[i]["vocals"] for i in at])) > SURE
    peak = "drop" if (beats and waited and not hook) else "chorus"
    lead = "build" if peak == "drop" else "pre-chorus"

    name = [None] * n
    for i in at:
        name[i] = peak

    if got[0]["loud"] < strong * 0.6 and first > 0:
        name[0] = "intro"
    if got[-1]["loud"] < mid and last < n - 1:
        name[-1] = "outro"

    for i in range(n - 1):
        if name[i] is None and name[i + 1] == peak:
            if got[i]["rise"] > CLIMB or got[i]["climb"] > CLIMB:
                name[i] = lead

    for i in range(1, n):
        if (name[i] is None and name[i - 1] == peak
                and got[i]["mark"] != anchor
                and got[i]["loud"] >= strong * 0.60):
            name[i] = "post-chorus"

    for i, s in enumerate(got):
        if name[i] is None and s["loud"] < strong * 0.55 and s["wide"] < broad:
            came = got[i - 1] if i > 0 else None
            if came is not None and (came["wide"] > s["wide"]
                                     or came["loud"] > s["loud"] * 1.5):
                name[i] = "breakdown"

    for i, s in enumerate(got):
        if name[i] is None and s["vocals"] > SURE and seen[s["mark"]] >= 2:
            name[i] = "verse"

    for i, s in enumerate(got):
        if (name[i] is None and s["vocals"] < SURE
                and s["loud"] >= max(mid, strong * 0.45)
                and s["other"] > SURE and s["other"] > s["drums"]):
            name[i] = "solo"

    for i, s in enumerate(got):
        if (name[i] is None and seen[s["mark"]] == 1
                and 0.15 < (i / n) < 0.85 and 4 <= s["bars"] <= 16
                and s["loud"] >= strong * 0.35 and s["wide"] >= broad - 1):
            name[i] = "bridge"

    for i, s in enumerate(got):
        if name[i] is None and s["bars"] <= 8 and 0 < i < n - 1:
            name[i] = "interlude"

    for i, s in enumerate(got):
        if name[i] is None:
            if s["vocals"] > SURE * 0.6:
                name[i] = "verse"
            elif s["loud"] < mid:
                name[i] = "breakdown"
            else:
                name[i] = "bridge"

    named = {}
    for i, s in enumerate(got):
        if name[i] not in ("interlude", "developing", "bridge",
                           "intro", "outro"):
            named.setdefault(s["mark"], name[i])
    for i, s in enumerate(got):
        if name[i] in ("interlude", "developing") and s["mark"] in named:
            name[i] = named[s["mark"]]

    got, name = settle(got, name, bars)
    n = len(got)

    letters = {}
    for s in got:
        if s["mark"] not in letters:
            letters[s["mark"]] = chr(ord("A") + len(letters) % 26)

    for i, s in enumerate(got):
        if i == 0:
            s["edge"] = None
            s["sudden"] = None
            continue
        worth = edge(bars, got[i - 1]["from"], s["from"], s["to"])
        s["edge"] = None if worth is None else round(worth, 2)
        step = sudden(bars, got[i - 1]["from"], s["from"], s["to"])
        s["sudden"] = None if step is None else round(step, 2)

    count = {}
    for s, word in zip(got, name):
        count[word] = count.get(word, 0) + 1
        s["role"] = word
        s["nth"] = count[word]
        s["like"] = letters[s["mark"]]
        s["returns"] = seen[s["mark"]] > 1
    return got
