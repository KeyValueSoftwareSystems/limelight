"""Bar-level phase labelling from audio features (tuned on faded.mp3 and raga.mp3, 2026-09-12).

label_bars(bass_rel, loud_rel, onsets=None) -> one label per bar:
  drop       kick/bass at full (bass within DROP_DB of the track max). High bars separated by a
             1-2 bar dropout form one block with a 'gap' inside; blocks shorter than MIN_DROP_BARS
             are not drops (they become verse/anthem).
  gap        a 1-2 bar real bass dropout inside a drop block (blackout, then the next hit)
  build      up to BUILD_MAX bars leading into a drop block: moderately loud, bass held back
  intro      the leading bars until two consecutive bars are loud AND beat-driven (onsets)
  verse      before the first drop: moderate
  anthem     after the first drop: energetic but not a drop (a verse riding the beat, a vocal
             chorus, the tail of a long block > LONG_BLOCK after its first DROP_HEAD bars)
  breakdown  after the first drop: quiet, bass-light
  outro      every bar after the final drop block
Single-bar islands (except gap) take the previous bar's label.
"""
import numpy as np

DROP_DB = -5.0
MIN_DROP_BARS = 4
BUILD_MAX = 8
BUILD_LOUD_MIN = -8.0
BUILD_BASS_MAX = -4.0
QUIET_LOUD = -10.0
BEAT_ONSETS = 6.0        # onsets per bar that count as "the beat is in"
ANTHEM_BASS_MIN = -9.0
GAP_MAX = 2
GAP_BASS_MAX = -8.0
LONG_BLOCK = 12
DROP_HEAD = 8


def _runs(mask):
    runs, start = [], None
    for i, m in enumerate(list(mask) + [False]):
        if m and start is None:
            start = i
        elif not m and start is not None:
            runs.append((start, i)); start = None
    return runs


def _intro_end(loud, onsets):
    """First bar where this bar and the next are loud and beat-driven; else no intro at all."""
    n = len(loud)
    for i in range(n - 1):
        ok = lambda k: loud[k] > QUIET_LOUD and (onsets is None or onsets[k] >= BEAT_ONSETS)
        if ok(i) and ok(i + 1):
            return i
    return 0


def label_bars(bass_rel, loud_rel, onsets=None):
    bass = np.asarray(bass_rel, float); loud = np.asarray(loud_rel, float)
    onsets = None if onsets is None else np.asarray(onsets, float)
    n = len(bass)
    lab = [None] * n
    high = bass >= DROP_DB

    # 1. gaps: short real dropouts between high bars join the surrounding block
    gaps = set()
    for s, e in _runs(~high):
        if 0 < s and e < n and e - s <= GAP_MAX and bass[s:e].max() < GAP_BASS_MAX:
            gaps.update(range(s, e)); high[s:e] = True
    # 2. blocks; too-short ones are not drops
    blocks = [(s, e) for s, e in _runs(high) if e - s >= MIN_DROP_BARS]
    for s, e in _runs(high):
        if e - s < MIN_DROP_BARS:
            high[s:e] = False
            gaps.difference_update(range(s, e))
    for bi, (s, e) in enumerate(blocks):
        final = bi == len(blocks) - 1
        for i in range(s, e):
            if i in gaps:
                lab[i] = "gap"
            else:
                lab[i] = "drop" if (final or e - s <= LONG_BLOCK or i - s < DROP_HEAD) else "anthem"
    # 3. builds: walk back from each block start
    for s, e in blocks:
        i, k = s - 1, 0
        while i >= 0 and k < BUILD_MAX and lab[i] is None and loud[i] > BUILD_LOUD_MIN and bass[i] < BUILD_BASS_MAX:
            lab[i] = "build"; i -= 1; k += 1
    # 4. everything else
    first_drop = blocks[0][0] if blocks else n
    last_end = blocks[-1][1] if blocks else n
    intro_end = min(_intro_end(loud, onsets), first_drop)
    for i in range(n):
        if lab[i] is not None:
            continue
        if i < intro_end:
            lab[i] = "intro"
        elif i < first_drop:
            lab[i] = "intro" if loud[i] <= QUIET_LOUD else "verse"
        elif i >= last_end:
            lab[i] = "outro"
        else:
            lab[i] = "anthem" if bass[i] > ANTHEM_BASS_MIN else "breakdown"
    # 5. smooth single-bar islands (never touch gaps or the first bar of a drop)
    for i in range(1, n - 1):
        if lab[i] != "gap" and lab[i] != lab[i - 1] and lab[i] != lab[i + 1] and lab[i - 1] != "gap":
            if lab[i] == "drop" and lab[i + 1] in ("drop", "gap"):
                continue
            lab[i] = lab[i - 1]
    return lab


def phases_from_labels(downbeats, labels, duration):
    """Merge equal consecutive labels into phases with real start/end times.
    The first phase starts at 0 (lead-in before bar 0); an 'outro' covers the time
    after the last bar until `duration`."""
    db = [float(x) for x in downbeats]
    bar = float(np.median(np.diff(db))) if len(db) > 1 else 2.0
    ends = db[1:] + [db[-1] + bar]
    phases = []
    for start, end, lab in zip(db, ends, labels):
        if phases and phases[-1]["phase"] == lab:
            phases[-1]["end"] = end
        else:
            phases.append({"start": start, "end": end, "phase": lab})
    duration = float(duration)
    phases = [dict(p, end=min(p["end"], duration)) for p in phases if p["start"] < duration]
    if phases:
        phases[0]["start"] = 0.0
        if phases[-1]["end"] < duration:
            if phases[-1]["phase"] == "outro":
                phases[-1]["end"] = duration
            else:
                phases.append({"start": phases[-1]["end"], "end": duration, "phase": "outro"})
    return phases
