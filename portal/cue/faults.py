import json
import os
import subprocess
import sys
import statistics as st

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))


def score_for(song):
    out = (
        subprocess.check_output(
            [
                "node",
                "-e",
                "console.log(require('./protocol/fixture.js').pick(%r))" % song,
            ],
            cwd=REPO,
            stderr=subprocess.DEVNULL,
        )
        .decode()
        .strip()
    )
    return json.load(open(out))


def lamp_offsets(show):
    return [f["address"] - 1 for f in show["fixtures"] if f["type"].startswith("par")]


def head_of(show):
    for f in show["fixtures"]:
        if not f["type"].startswith("par"):
            return f["address"] - 1
    return None


def perceived(frame, off):
    v = (frame[off + 1] * 0.299 + frame[off + 2] * 0.587 + frame[off + 3] * 0.114) * (
        frame[off] / 255.0
    )
    return (max(v, 0.0) / 255.0) ** 0.625 * 255.0


def hue_of(frame, off):
    r, g, b = frame[off + 1] / 255.0, frame[off + 2] / 255.0, frame[off + 3] / 255.0
    mx, mn = max(r, g, b), min(r, g, b)
    if mx < 0.10:
        return None
    if mx - mn < 0.06:
        return "white"
    if mx == r:
        h = (g - b) / (mx - mn) % 6
    elif mx == g:
        h = (b - r) / (mx - mn) + 2
    else:
        h = (r - g) / (mx - mn) + 4
    return int(h * 60 / 30) % 12


def scan(song, lights):
    show = json.load(open(lights))
    frames = show["frames"]
    fps = show.get("fps", 40)
    sc = score_for(song)
    OFF = lamp_offsets(show)
    H = head_of(show)
    n = len(frames)
    L = [[perceived(f, o) for o in OFF] for f in frames]
    rig = [sum(r) / len(r) for r in L]
    faults = []
    deliberate = []
    for a in show.get("accents") or []:
        t0 = float(a.get("t", 0))
        deliberate.append((t0 - 0.06, t0 + float(a.get("decay", 0.2)) * 2.5 + 0.2))
    for c in show.get("cuelist") or []:
        t0 = float(c.get("t", 0))
        deliberate.append((t0 - 0.06, t0 + max(0.12, float(c.get("fade") or 0)) + 0.1))

    def planned(t):
        return any(a <= t <= b for a, b in deliberate)

    def add(t, kind, text):
        faults.append((round(t, 2), kind, text))

    lead = []
    cur = 0
    for r in L:
        top = max(range(len(OFF)), key=lambda k: r[k])
        if top != cur and r[top] - r[cur] < 8:
            top = cur
        cur = top
        lead.append(top)
    hold_n = max(1, int(0.1 * fps))
    sw = []
    for i in range(1, n):
        if lead[i] == lead[i - 1] or max(L[i]) <= 12:
            continue
        if not all(lead[j] == lead[i] for j in range(i, min(n, i + hold_n))):
            continue
        jump = 0.0
        for j in range(max(1, i - 2), min(n, i + 3)):
            jump = max(jump, max(abs(L[j][k] - L[j - 1][k]) for k in range(len(OFF))))
        if jump < 6:
            continue
        sw.append(i)
    for a, b in zip(sw, sw[1:]):
        if (b - a) / fps < 0.22 and not planned(a / fps) and not planned(b / fps):
            add(
                a / fps,
                "lead-churn",
                "the brightest lamp changes again after %.0fms"
                % ((b - a) / fps * 1000),
            )

    for k in range(len(OFF)):
        i = 1
        while i < n - 1:
            if L[i][k] > 90 and L[i - 1][k] < 25:
                j = i
                while j < n and L[j][k] > 60:
                    j += 1
                if (j - i) / fps < 0.09 and not planned(i / fps):
                    add(
                        i / fps,
                        "blip",
                        "lamp %d flashes for only %.0fms"
                        % (k + 1, (j - i) / fps * 1000),
                    )
                i = j
            i += 1

    for k in range(len(OFF)):
        turns = 0
        run_start = 0
        for i in range(2, n):
            d0 = L[i - 1][k] - L[i - 2][k]
            d1 = L[i][k] - L[i - 1][k]
            if abs(d0) > 9 and abs(d1) > 9 and d0 * d1 < 0:
                if turns == 0:
                    run_start = i
                turns += 1
            elif turns:
                if turns >= 4 and (i - run_start) / fps < 1.2:
                    add(
                        run_start / fps,
                        "ping-pong",
                        "lamp %d reverses direction %d times in %.1fs"
                        % (k + 1, turns, (i - run_start) / fps),
                    )
                turns = 0

    hues = [[hue_of(f, o) for o in OFF] for f in frames]
    hold_frames = max(1, int(0.1 * fps))
    for k in range(len(OFF)):
        seq = []
        cur, start = None, 0
        for i in range(n):
            h = hues[i][k]
            if h != cur:
                if cur is not None and i - start >= hold_frames:
                    seq.append((cur, start, i))
                cur, start = h, i
        if cur is not None and n - start >= hold_frames:
            seq.append((cur, start, n))
        seq = [x for x in seq if x[0] is not None]
        for a in range(len(seq) - 2):
            (h0, s0, e0), (h1, s1, e1), (h2, s2, e2) = seq[a], seq[a + 1], seq[a + 2]
            if h0 == h2 and h0 != h1 and (s2 - s0) / fps < 2.0 and not planned(s1 / fps):
                add(s0 / fps, "colour-flipflop",
                    "lamp %d leaves its colour for %.2fs and comes straight back"
                    % (k + 1, (s2 - s1) / fps))

    i = 0
    while i < n:
        if rig[i] < 4:
            j = i
            while j < n and rig[j] < 4:
                j += 1
            d = (j - i) / fps
            if 0.05 < d < 0.2 and i / fps > 0.2:
                add(
                    i / fps,
                    "flicker-out",
                    "the room drops out for only %.0fms" % (d * 1000),
                )
            i = j
        else:
            i += 1

    temporal0 = sc.get("stems_temporal") or {}
    win0 = temporal0.get("window_s", 0.5)
    lanes0 = temporal0.get("stems", {})
    nw = max((len(v) for v in lanes0.values()), default=0)
    tot0 = [sum((v[w] if w < len(v) else 0) for v in lanes0.values()) for w in range(nw)]
    med0 = st.median([x for x in tot0 if x > 0]) if any(tot0) else 1.0
    loud_windows = [x / (med0 or 1) for x in tot0]
    run = 0
    for i in range(n):
        if rig[i] < 4:
            run += 1
        else:
            if run / fps > 3.0:
                w0 = int(((i - run) / fps) / win0)
                seg = loud_windows[w0:max(w0 + 1, int((i / fps) / win0))]
                if seg and max(seg) > 0.25:
                    add((i - run) / fps, "blank-over-music",
                        "the room is dark for %.1fs while the music is playing" % (run / fps))
            run = 0

    lengths = {}
    for k in range(len(OFF)):
        run = 0
        best = 0
        for i in range(n):
            if L[i][k] < 10:
                run += 1
                best = max(best, run)
            else:
                run = 0
        lengths[k] = best / fps
    if lengths:
        worst = max(lengths, key=lambda k: lengths[k])
        others = st.median([lengths[k] for k in lengths if k != worst])
        if lengths[worst] > 12 and lengths[worst] > others * 2.5:
            add(
                0,
                "lamp-idle",
                "lamp %d sits dark for %.0fs while the others do not"
                % (worst + 1, lengths[worst]),
            )

    if H is not None:
        pan = [f[H] for f in frames]
        turns = 0
        run_start = 0
        for i in range(2, n):
            d0 = pan[i - 1] - pan[i - 2]
            d1 = pan[i] - pan[i - 1]
            if abs(d0) >= 2 and abs(d1) >= 2 and d0 * d1 < 0:
                if turns == 0:
                    run_start = i
                turns += 1
            elif turns:
                if turns >= 5 and (i - run_start) / fps < 2.0:
                    add(
                        run_start / fps,
                        "head-jitter",
                        "the head reverses %d times in %.1fs"
                        % (turns, (i - run_start) / fps),
                    )
                turns = 0

    beats = [b["t"] for b in sc.get("beats", [])]
    length = sc["song"]["length_s"]
    loud_pre = None
    loud_windows = []
    temporal = sc.get("stems_temporal") or {}
    win = temporal.get("window_s", 0.5)
    lanes = temporal.get("stems", {})
    loud = []
    steps = int(length / win) + 1
    for w in range(steps):
        loud.append(sum((v[w] if w < len(v) else 0) for v in lanes.values()))
    if loud:
        hi = max(loud) or 1
        for w, e in enumerate(loud):
            a, b = int(w * win * fps), int((w + 1) * win * fps)
            if b > n:
                break
            seg = rig[a:b]
            if not seg:
                continue
            m = sum(seg) / len(seg)
            if e / hi > 0.55 and m < 12:
                add(
                    w * win,
                    "dark-on-loud",
                    "the music is at %.0f%% and the room is at %.0f/255"
                    % (e / hi * 100, m),
                )
            if e / hi < 0.06 and m > 110:
                add(
                    w * win,
                    "bright-on-silence",
                    "the music is at %.0f%% and the room is at %.0f/255"
                    % (e / hi * 100, m),
                )

    for k in range(len(OFF)):
        run = 0
        for i in range(n):
            if L[i][k] > 248:
                run += 1
                if run == int(2.0 * fps):
                    add(
                        (i - run) / fps,
                        "pinned",
                        "lamp %d sits at full for over 2s" % (k + 1),
                    )
            else:
                run = 0

    return faults


def main():
    song = sys.argv[1] if len(sys.argv) > 1 else "raga-of-revenge"
    lights = sys.argv[2] if len(sys.argv) > 2 else "/tmp/%s.cuelights.json" % song
    faults = scan(song, lights)
    by_kind = {}
    for t, kind, text in faults:
        by_kind.setdefault(kind, []).append((t, text))
    print("  %d faults in %s" % (len(faults), song))
    for kind in sorted(by_kind, key=lambda k: -len(by_kind[k])):
        rows = sorted(by_kind[kind])
        print("\n  %-18s %d" % (kind, len(rows)))
        for t, text in rows[:6]:
            print("      %7.2fs  %s" % (t, text))
        if len(rows) > 6:
            print("      ... and %d more" % (len(rows) - 6))


if __name__ == "__main__":
    main()
