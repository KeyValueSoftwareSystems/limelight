import numpy as np

NEAR_MAX = 10 ** (-5 / 20)
LOUD = 10 ** (-8 / 20)
LIGHT = 10 ** (-4 / 20)
ALIVE = 10 ** (-10 / 20)
MID = 10 ** (-9 / 20)
DEEP = 10 ** (-8 / 20)


def blocks(hot, join=2, least=4):
    runs, i = [], 0
    while i < len(hot):
        if not hot[i]:
            i += 1
            continue
        j = i
        while j < len(hot):
            if hot[j]:
                j += 1
                continue
            k = j
            while k < len(hot) and not hot[k]:
                k += 1
            if k - j <= join and k < len(hot):
                j = k
            else:
                break
        if j - i >= least:
            runs.append((i, j))
        i = max(j, i + 1)
    return runs


def grid(spans, pickup, firm=None, steps=(4, 8, 16), least=3, lift=2.0):
    heard = sorted(set(firm)) if firm else [a for a, _, _ in spans]
    n = len(heard) or 1

    def told(start, step):
        hit = sum(1 for a in heard
                  if a - pickup + 1 - start >= 0
                  and (a - pickup + 1 - start) % step == 0)
        return hit, hit / n * step

    origin, gain = 1, -1.0
    for step in steps:
        for start in (1, 0):
            _, over = told(start, step)
            if over > gain:
                origin, gain = start, over
    for step in steps:
        hit, over = told(origin, step)
        if hit >= least and over >= lift:
            return origin, step, True
    return origin, steps[0], False


def anchor(spans, pickup, reach=2, firm=None):
    return grid(spans, pickup, firm)[0]


def on_phrase(spans, pickup, reach=2, least=4, firm=None, tell=None):
    origin, every, holds = grid(spans, pickup, firm)

    def snap(bar):
        for step in (16, 8, 4):
            near = origin + round((bar - origin) / step) * step
            if abs(near - bar) <= reach and near >= origin:
                return near, step
        return bar, 0

    pinned = sorted(firm or ())
    if not pinned:
        holds = True
    if tell is not None:
        tell["origin"] = origin
        tell["every"] = every
        tell["on_grid"] = bool(holds)

    moved = []
    for a, b, role in spans:
        bar = a - pickup + 1
        if bar < 1:
            moved.append([a, b, role, 0])
            continue
        if a in set(pinned):
            moved.append([a, b, role, 0])
            continue
        if not holds:
            close = [f for f in pinned if abs(f - a) <= 2]
            if close:
                at = min(close, key=lambda f: (abs(f - a), f))
                moved.append([max(0, at), b, role, 0])
                continue
        near, step = snap(bar)
        moved.append([max(0, near - 1 + pickup), b, role, step])

    out = []
    for i, (a, b, role, step) in enumerate(moved):
        if out and a <= out[-1][0]:
            continue
        if out:
            out[-1][1] = a
        out.append([a, b, role, step])
    out = [s for s in out if s[1] - s[0] >= least or s is out[-1]]
    for i in range(len(out) - 1):
        out[i][1] = out[i + 1][0]
    return [(a, b, role) for a, b, role, _ in out]


def read(bars, onsets_per_bar=None, pickup=0):
    low = np.asarray(bars["bass"], dtype=float)
    loud = np.asarray([x if x is not None else 0.0 for x in bars["intensity"]], dtype=float)
    n = len(low)
    top = np.percentile(low, 98) or 1.0
    low = low / top
    loud = loud / (np.percentile(loud, 98) or 1.0)
    busy = (np.asarray(onsets_per_bar, dtype=float) if onsets_per_bar is not None
            else np.full(n, 6.0))

    told = [None] * n
    hot = loud >= NEAR_MAX
    runs = blocks(hot)

    earned = set()
    for a, b in runs:
        lead = [i for i in range(max(0, a - 8), a)
                if loud[i] > LOUD and low[i] < LIGHT]
        quiet = any(loud[i] < DEEP * 0.5 for i in range(max(0, a - 2), min(b, a + 2)))
        if len(lead) >= 2 or quiet:
            earned.add(a)
        for i in range(a, b):
            told[i] = "drop" if a in earned else "full"
        for i in range(a, b):
            if loud[i] < DEEP * 0.5:
                told[i] = "gap"

    if runs:
        first = runs[0][0]
        inside = set()
        for a, b in runs:
            inside.update(range(a, b))
        for a, b in runs:
            back = 0
            i = a - 1
            while (i >= 0 and back < 8 and told[i] is None and i not in inside
                   and loud[i] > LOUD and low[i] < LIGHT):
                told[i] = "build"
                back += 1
                i -= 1

        started = 0
        for i in range(n - 1):
            if loud[i] > ALIVE and loud[i + 1] > ALIVE and busy[i] >= 6 and busy[i + 1] >= 6:
                started = i
                break
        for i in range(min(started, first)):
            if told[i] is None:
                told[i] = "intro"
        for i in range(first):
            if told[i] is None:
                told[i] = "verse"

        last = runs[-1][1]
        for i in range(first, n):
            if told[i] is not None:
                continue
            told[i] = "anthem" if loud[i] > MID else "breakdown"
        for i in range(last, n):
            told[i] = "outro"
    else:
        for i in range(n):
            told[i] = "intro" if loud[i] < ALIVE else "verse"

    for i in range(1, n - 1):
        if told[i] != told[i - 1] and told[i] != told[i + 1] and told[i - 1] == told[i + 1]:
            told[i] = told[i - 1]

    spans, i = [], 0
    while i < n:
        j = i
        while j < n and told[j] == told[i]:
            j += 1
        spans.append([i, j, told[i]])
        i = j

    spans = on_phrase(spans, pickup)
    spans = [list(s) for s in spans]
    joined = []
    for s in spans:
        if joined and joined[-1][2] == s[2]:
            joined[-1][1] = s[1]
        else:
            joined.append(s)
    spans = joined
    for word in ("drop", "full"):
        seen = 0
        for s in spans:
            if s[2] == word:
                seen += 1
                s[2] = word if seen == 1 else f"{word} {seen}"
    return spans
