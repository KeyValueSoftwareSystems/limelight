#!/usr/bin/env python3
import array, cmath, json, math, os, shutil, subprocess, sys, wave

USAGE = (
    "ear.py -- audio in, map out. stdlib only.\n\n"
    "    python3 listen/ear.py synth/out/06-repeat.wav > cand.json\n"
    '    python3 synth/loop.py --listener "python3 listen/ear.py"\n'
)

BPM_LO, BPM_HI = 60.0, 180.0
KICK_LO_HZ, KICK_HI_HZ = 35.0, 130.0
ENV_HZ = 400.0
DEC_HZ = 1000.0
LOOKUP_S = 0.004
BAR_CUE_FLOOR = 0.35
ADDED_BEAT_SUPPORT_FLOOR = 0.45
ADDED_BEAT_SUPPORT_CEIL = 1.25


DECODE_SR = 32000


def _from_wav(path):
    with wave.open(path, "rb") as w:
        sr, n, ch, sw = (
            w.getframerate(),
            w.getnframes(),
            w.getnchannels(),
            w.getsampwidth(),
        )
        raw = w.readframes(n)
    if sw != 2:
        return None, None
    a = array.array("h")
    a.frombytes(raw[: len(raw) - (len(raw) % 2)])
    if sys.byteorder == "big":
        a.byteswap()
    if ch > 1:
        a = a[::ch]
    return [v / 32768.0 for v in a], sr


def _from_ffmpeg(path):
    if not shutil.which("ffmpeg"):
        return None, None
    out = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "quiet",
            "-i",
            path,
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            str(DECODE_SR),
            "-",
        ],
        stdout=subprocess.PIPE,
    ).stdout
    if not out:
        return None, None
    a = array.array("h")
    a.frombytes(out[: len(out) - (len(out) % 2)])
    if sys.byteorder == "big":
        a.byteswap()
    return [v / 32768.0 for v in a], float(DECODE_SR)


def read_audio(path):
    if path.lower().endswith(".wav"):
        x, sr = _from_wav(path)
        if x:
            return x, sr
    x, sr = _from_ffmpeg(path)
    if x:
        return x, sr
    sys.exit(f"{path}: could not decode. Install ffmpeg, or supply 16-bit wav.")


def block_average_decimate(x, sr, target_hz):
    k = max(1, int(round(sr / target_hz)))
    return [sum(x[i : i + k]) / k for i in range(0, len(x) - k + 1, k)], sr / k


def bandpass(x, sr, lo_hz, hi_hz):
    centre = math.sqrt(lo_hz * hi_hz)
    q = centre / max(1e-9, hi_hz - lo_hz)
    w0 = 2 * math.pi * centre / sr
    alpha = math.sin(w0) / (2 * q)
    cosw = math.cos(w0)
    a0 = 1 + alpha
    b0, b2 = alpha / a0, -alpha / a0
    a1, a2 = (-2 * cosw) / a0, (1 - alpha) / a0
    out = [0.0] * len(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        y = b0 * v + b2 * x2 - a1 * y1 - a2 * y2
        out[i] = y
        x2, x1 = x1, v
        y2, y1 = y1, y
    return out


def peak_envelope(x, sr, out_hz):
    k = max(1, int(round(sr / out_hz)))
    env = [
        max((abs(v) for v in x[i : i + k]), default=0.0)
        for i in range(0, len(x) - k + 1, k)
    ]
    return env, sr / k


def onset_flux(env):
    return [0.0] + [max(0.0, env[j] - env[j - 1]) for j in range(1, len(env))]


def flux_near(fx, centre_idx, half_width):
    lo, hi = max(0, centre_idx - half_width), min(len(fx), centre_idx + half_width + 1)
    return max(fx[lo:hi]) if hi > lo else 0.0


def grid_salience(fx, rate, period, phase, dur, half_width):
    total, n, t = 0.0, 0, phase
    while t < dur:
        total += flux_near(fx, int(t * rate), half_width)
        n += 1
        t += period
    return (total / n) if n else 0.0


def added_beat_support(fx, rate, period, phase, dur, half_width):
    even, odd, n, t = [], [], 0, phase
    while t < dur:
        v = flux_near(fx, int(t * rate), half_width)
        (even if n % 2 == 0 else odd).append(v)
        n += 1
        t += period
    if not even or not odd:
        return 0.0
    mean_even = sum(even) / len(even)
    return (sum(odd) / len(odd)) / mean_even if mean_even > 1e-12 else 0.0


def best_phase_for_period(fx, rate, period, dur, half_width, divisions=64):
    best_score, best_phase = -1.0, 0.0
    steps = max(8, int(period * rate))
    for si in range(0, steps, max(1, steps // divisions)):
        phase = si / rate
        if phase >= period:
            break
        score = grid_salience(fx, rate, period, phase, dur, half_width)
        if score > best_score:
            best_score, best_phase = score, phase
    return best_phase, best_score


def fit_grid(fx, rate, dur):
    half_width = max(1, int(round(LOOKUP_S * rate)))

    coarse = (0.0, None, None)
    bpm = BPM_LO
    while bpm <= BPM_HI + 1e-9:
        period = 60.0 / bpm
        phase, score = best_phase_for_period(fx, rate, period, dur, half_width, 48)
        if score > coarse[0]:
            coarse = (score, period, phase)
        bpm += 0.5
    _, fitted_period, _ = coarse
    if fitted_period is None:
        return None, None, 0.0, "no onsets found"

    candidates = []
    for name, period in (
        ("half", fitted_period / 2),
        ("as-fit", fitted_period),
        ("double", fitted_period * 2),
    ):
        if not (60.0 / BPM_HI <= period <= 60.0 / BPM_LO):
            continue
        phase, score = best_phase_for_period(fx, rate, period, dur, half_width)
        support = added_beat_support(fx, rate, period, phase, dur, half_width)
        candidates.append((name, period, phase, score, support))

    candidates.sort(key=lambda c: c[1])
    notes = []
    chosen = next(
        (c for c in candidates
         if ADDED_BEAT_SUPPORT_FLOOR <= c[4] <= ADDED_BEAT_SUPPORT_CEIL),
        None,
    )
    if chosen is None:
        chosen = max(candidates, key=lambda c: c[3])
        notes.append("no grid had supported off-beats; fell back to strongest")
    name, period, phase, score, support = chosen
    if name != "as-fit":
        notes.append(f"octave corrected to {name} (added-beat support {support:.2f})")

    for dp in [d / 20000.0 for d in range(-200, 201, 5)]:
        trial_period = period + dp
        if trial_period <= 0:
            continue
        for dph in [d / rate for d in range(-8, 9)]:
            trial_phase = phase + dph
            if trial_phase < 0:
                continue
            s = grid_salience(fx, rate, trial_period, trial_phase, dur, half_width)
            if s > score:
                score, period, phase = s, trial_period, trial_phase
    return period, phase % period, score, "; ".join(notes)


TON_N = 512
TON_RATE_HZ = 8000.0
TON_LO_HZ, TON_HI_HZ = 400.0, 4000.0
TON_WINDOW = [0.5 - 0.5 * math.cos(2 * math.pi * i / (TON_N - 1)) for i in range(TON_N)]


def _fft(a):
    n = len(a)
    a = list(a)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j |= bit
        if i < j:
            a[i], a[j] = a[j], a[i]
    length = 2
    while length <= n:
        ang = -2 * math.pi / length
        wl = complex(math.cos(ang), math.sin(ang))
        for i in range(0, n, length):
            w = 1 + 0j
            for k in range(i, i + length // 2):
                u = a[k]
                v = a[k + length // 2] * w
                a[k] = u + v
                a[k + length // 2] = u - v
                w *= wl
        length <<= 1
    return a


def beat_tonality(samples, sr, beats, period):
    sig, rate = block_average_decimate(samples, sr, TON_RATE_HZ)
    k0 = max(1, int(TON_LO_HZ * TON_N / rate))
    k1 = min(TON_N // 2, int(TON_HI_HZ * TON_N / rate))
    if k1 <= k0 + 1:
        return [0.0] * len(beats)
    flat = []
    for t in beats:
        i0 = int(t * rate)
        i1 = min(len(sig), i0 + max(TON_N, int(period * rate)))
        acc, p = [], i0
        while p + TON_N <= i1:
            spec = _fft([complex(sig[p + i] * TON_WINDOW[i], 0.0) for i in range(TON_N)])
            mag = [abs(spec[k]) + 1e-12 for k in range(k0, k1)]
            geo = math.exp(sum(math.log(v) for v in mag) / len(mag))
            arith = sum(mag) / len(mag)
            acc.append(geo / arith)
            p += TON_N // 2
        flat.append(sum(acc) / len(acc) if acc else 1.0)
    lo, hi = min(flat), max(flat)
    return [1.0 - ((v - lo) / (hi - lo + 1e-12)) for v in flat]


SPOTLIGHT_TON = 0.80
SPOTLIGHT_SEP_BEATS = 32


def spotlights_from_tonality(tonal, beats, groups, curve):
    if not tonal or not curve:
        return []
    energies = sorted(v for _, v in curve)
    median_energy = energies[len(energies) // 2]
    quiet_at = {round(t, 3): v for t, v in curve}
    index = {round(b, 3): i for i, b in enumerate(beats)}
    picked = []
    for g in groups:
        i = index.get(round(g, 3))
        if i is None or i < 2 or i >= len(tonal) - 2:
            continue
        window = tonal[max(0, i - 8) : i + 9]
        if tonal[i] < SPOTLIGHT_TON or tonal[i] < max(window) - 1e-9:
            continue
        if quiet_at.get(round(g, 3), 1.0) > median_energy * 0.85:
            continue
        if picked and (i - picked[-1][0]) < SPOTLIGHT_SEP_BEATS:
            continue
        picked.append((i, g))
    return [{"at": round(g, 6), "kind": "spotlight"} for _, g in picked]


keep_rate = [0.0]
BAR_BANDS = ((35.0, 130.0), (130.0, 400.0), (400.0, 1200.0), (1200.0, 1900.0))
BAR_RATE_HZ = 4000.0


def beat_band_profile(samples, sr, beats, period, keep=None):
    wide, wrate = block_average_decimate(samples, sr, BAR_RATE_HZ)
    profile = []
    for lo_hz, hi_hz in BAR_BANDS:
        band = bandpass(wide, wrate, lo_hz, hi_hz)
        if keep is not None:
            keep.append(band)
            keep_rate[0] = wrate
        per_beat = []
        for bt in beats:
            i0 = int(bt * wrate)
            i1 = min(len(band), i0 + max(1, int(period * wrate)))
            seg = band[max(0, i0) : i1]
            per_beat.append(
                math.sqrt(sum(v * v for v in seg) / len(seg)) if seg else 0.0
            )
        hi = max(per_beat) or 1.0
        profile.append([v / hi for v in per_beat])
    return profile


BAR_BAND_WEIGHTS = (1.0, 1.3, 0.5, 0.3)


def beat_novelty(profile, weights=None):
    n = len(profile[0]) if profile else 0
    out = [0.0] * n
    for i in range(1, n):
        out[i] = sum(
            (weights[b] if weights else 1.0) * abs(band[i] - band[i - 1])
            for b, band in enumerate(profile)
        )
    return out


STRUCT_MIN_PEAKS = 6
STRUCT_MIN_NOVELTY = 0.05
STRUCT_MIN_CUE = 0.30
STRUCT_MIN_SEP = 8
STRUCT_TOPK = 24


def _peak_indices(series, n_beats, min_sep, topk):
    order = sorted(range(len(series)), key=lambda i: -series[i])
    picked = []
    for i in order:
        if i < 4 or i > n_beats - 4:
            continue
        if any(abs(i - j) < min_sep for j in picked):
            continue
        picked.append(i)
        if len(picked) >= topk:
            break
    return picked


def _residue_votes(series, n_beats, beats_per_bar):
    picked = _peak_indices(series, n_beats, STRUCT_MIN_SEP, STRUCT_TOPK)
    if len(picked) < STRUCT_MIN_PEAKS or _median([series[i] for i in picked]) < STRUCT_MIN_NOVELTY:
        return None
    votes = [0] * beats_per_bar
    for i in picked:
        votes[i % beats_per_bar] += 1
    return votes


def refine_phase(fx, rate, period, phase, dur, half_width):
    offsets = []
    t = phase
    while t < dur:
        c = int(t * rate)
        lo, hi = max(0, c - half_width), min(len(fx), c + half_width + 1)
        if hi - lo >= 3:
            window = fx[lo:hi]
            total = sum(window)
            if total > 1e-12:
                centroid = sum(i * v for i, v in enumerate(window)) / total
                offsets.append((lo + centroid) / rate - t)
        t += period
    if len(offsets) < 8:
        return phase
    return phase + _median(offsets)


def bar_phase_from_structure(profile, beats_per_bar=4):
    n = len(profile[0]) if profile else 0
    if n < beats_per_bar * 4:
        return 0, 0.0
    novelty = beat_novelty(profile)
    crash = [0.0] + [max(0.0, profile[3][i] - profile[3][i - 1]) for i in range(1, n)]
    bassmove = [0.0] + [abs(profile[1][i] - profile[1][i - 1]) for i in range(1, n)]

    results = []
    for series, weight in ((novelty, 1.0), (crash, 1.0), (bassmove, 0.9)):
        votes = _residue_votes(series, n, beats_per_bar)
        if votes is None:
            continue
        top = max(range(beats_per_bar), key=lambda b: votes[b])
        rest = (sum(votes) - votes[top]) / (beats_per_bar - 1)
        cue = (votes[top] - rest) / votes[top] if votes[top] else 0.0
        results.append((cue * weight, top))
    if not results:
        return 0, 0.0
    results.sort(reverse=True)
    best_cue, best_top = results[0]
    agree = sum(1 for c, t in results if t == best_top)
    if agree > 1:
        best_cue = min(0.95, best_cue + 0.12 * (agree - 1))
    return best_top, best_cue


def _median(values):
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def bar_phase(profile, beats_per_bar=4):
    if not profile or len(profile[0]) < beats_per_bar * 4:
        return 0, 0.0
    novelty = beat_novelty(profile, BAR_BAND_WEIGHTS)
    inner = novelty[beats_per_bar : len(novelty) - beats_per_bar]
    offset = beats_per_bar % beats_per_bar
    scores = []
    for b in range(beats_per_bar):
        scores.append(_median(inner[(b - offset) % beats_per_bar :: beats_per_bar]))
    top = max(range(beats_per_bar), key=lambda b: scores[b])
    hi = scores[top]
    rest = [s for i, s in enumerate(scores) if i != top]
    mean_rest = sum(rest) / len(rest) if rest else 0.0
    cue = (hi - mean_rest) / hi if hi > 1e-9 else 0.0
    return top, cue


def downbeat_energy(profile, beats, downbeats):
    weights = (1.0, 0.9, 0.8, 0.6)
    mixed = []
    for i in range(len(beats)):
        mixed.append(
            sum(w * profile[b][i] for b, w in enumerate(weights)) / sum(weights)
        )
    hi = max(mixed) or 1.0
    mixed = [v / hi for v in mixed]
    index = {round(b, 3): i for i, b in enumerate(beats)}
    curve = []
    for d in downbeats:
        i = index.get(round(d, 3))
        if i is None:
            continue
        window = mixed[i : i + 4] or [0.0]
        curve.append([round(d, 6), round(sum(window) / len(window), 4)])
    return curve


STOP_LOOKBACK_BEATS = 4
STOP_RATIO = 0.12
STOP_ABSOLUTE = 0.22
STOP_MIN_BEATS = 2


def find_stops(profile, beats, period):
    if not profile or len(beats) < STOP_LOOKBACK_BEATS + 4:
        return []
    n = len(profile[0])
    per_beat = [
        sum(profile[b][i] for b in range(len(profile))) / len(profile) for i in range(n)
    ]
    ordered = sorted(per_beat)
    song_typical = ordered[len(ordered) // 2] or 1.0
    floor = song_typical * STOP_ABSOLUTE
    stops, i = [], STOP_LOOKBACK_BEATS
    while i < n - 1:
        context = per_beat[i - STOP_LOOKBACK_BEATS : i]
        loud = sum(context) / len(context) if context else 0.0
        if loud <= 1e-9 or per_beat[i] > loud * STOP_RATIO or per_beat[i] > floor:
            i += 1
            continue
        j = i
        while j < n and per_beat[j] <= loud * STOP_RATIO and per_beat[j] <= floor:
            j += 1
        if j - i >= STOP_MIN_BEATS and j < n:
            stops.append(
                {
                    "at": round(beats[i], 3),
                    "kind": "stop",
                    "holds": round((j - i) * period, 3),
                }
            )
        i = j + 1
    return stops


MIN_SECTION_BARS = 2


def bar_profile(profile, beats, downbeats):
    index = {round(b, 3): i for i, b in enumerate(beats)}
    rows = []
    for d in downbeats:
        i = index.get(round(d, 3))
        if i is None:
            continue
        rows.append(
            [sum(band[i : i + 4]) / max(1, len(band[i : i + 4])) for band in profile]
        )
    return rows


SEG_LAG_BARS = 4


def _block_mean(rows, lo, hi):
    lo, hi = max(0, lo), min(len(rows), hi)
    if hi <= lo:
        return None
    n = len(rows[0])
    return [sum(rows[i][b] for i in range(lo, hi)) / (hi - lo) for b in range(n)]


def wide_novelty(rows, lag):
    out = [0.0] * len(rows)
    for i in range(len(rows)):
        before = _block_mean(rows, i - lag, i)
        after = _block_mean(rows, i, i + lag)
        if before is None or after is None:
            continue
        out[i] = sum(abs(after[b] - before[b]) for b in range(len(before)))
    return out


def _norm(v):
    hi = max(v) if v else 0.0
    return [x / hi for x in v] if hi > 1e-9 else list(v)


def segment(rows, curve=None, tone=None):
    if len(rows) < MIN_SECTION_BARS * 2:
        return [0]
    near = [0.0] * len(rows)
    for i in range(1, len(rows)):
        near[i] = sum(abs(rows[i][b] - rows[i - 1][b]) for b in range(len(rows[i])))
    lag = max(1, min(SEG_LAG_BARS, round(len(rows) / 32)))
    wide = wide_novelty(rows, lag)
    jump = [0.0] * len(rows)
    if curve:
        for i in range(1, min(len(rows), len(curve))):
            jump[i] = abs(curve[i][1] - curve[i - 1][1])
    nt = [0.0] * len(rows)
    if tone:
        lag = SEG_LAG_BARS
        for i in range(len(rows)):
            lo, hi = max(0, i - lag), min(len(tone), i + lag)
            if i - lo < 1 or hi - i < 1:
                continue
            before = sum(tone[lo:i]) / (i - lo)
            after = sum(tone[i:hi]) / (hi - i)
            nt[i] = abs(after - before)
    nn, nw, nj, ntn = _norm(near), _norm(wide), _norm(jump), _norm(nt)
    novelty = [0.6 * nn[i] + 1.0 * nw[i] + 0.7 * nj[i] for i in range(len(rows))]
    mean = sum(novelty) / len(novelty)
    spread = (sum((v - mean) ** 2 for v in novelty) / len(novelty)) ** 0.5
    threshold = mean + 0.12 * spread
    last_usable = len(rows) - MIN_SECTION_BARS
    proposed = set()
    for i in range(1, last_usable):
        if novelty[i] >= threshold:
            proposed.add(i)
    bounds = [0]
    for i in sorted(proposed):
        if i - bounds[-1] >= MIN_SECTION_BARS:
            bounds.append(i)
    return bounds


def classify(rows, bounds, n_bars):
    nband = len(rows[0])
    band_max = [max((r[b] for r in rows), default=1.0) or 1.0 for b in range(nband)]
    lows = sorted(r[0] / band_max[0] for r in rows)
    typical_low = lows[len(lows) // 2] or 1.0

    stats = []
    for k, start in enumerate(bounds):
        end = bounds[k + 1] if k + 1 < len(bounds) else n_bars
        seg = rows[start:end] or [rows[start]]
        mean = [sum(r[b] for r in seg) / len(seg) / band_max[b] for b in range(nband)]
        first = sum(seg[0]) / nband
        last = sum(seg[-1]) / nband
        stats.append(
            {
                "low": mean[0],
                "overall": sum(mean) / nband,
                "rising": len(seg) >= 3 and last > first * 1.3,
                "climbing": len(seg) >= 4 and last > first * 1.6,
            }
        )

    peak_overall = max(st["overall"] for st in stats) or 1.0
    loud_gate = peak_overall * 0.85

    labels = []
    for k, st in enumerate(stats):
        if k == 0:
            labels.append("intro")
        elif st["climbing"]:
            labels.append("build")
        elif st["low"] <= typical_low * 0.6:
            labels.append("break")
        elif st["rising"]:
            labels.append("build")
        elif st["overall"] >= loud_gate and st["low"] >= typical_low * 0.85:
            labels.append("drop")
        else:
            labels.append("verse")

    if len(labels) > 1 and labels[-1] == "break":
        labels[-1] = "outro"
    return labels


DROP_SNAP_RISE = 0.05
DROP_SNAP_MAX_BARS = 3
MERGE_ENERGY_TOL = 0.15
MERGE_MAX_BARS = 12
ALWAYS_MERGE = ("break", "verse", "outro", "intro")


def merge_runs(bounds, labels, curve, n_bars):
    def section_energy(k):
        a = bounds[k]
        b = bounds[k + 1] if k + 1 < len(bounds) else n_bars
        vals = [v for _, v in curve[a:b]]
        return sum(vals) / len(vals) if vals else 0.0

    def jump(i):
        b = bounds[i]
        if b <= 0 or b >= len(curve):
            return 0.0
        return curve[b][1] - curve[b - 1][1]

    kept_bounds, kept_labels = [], []
    i = 0
    while i < len(bounds):
        j = i
        while (
            j + 1 < len(bounds)
            and labels[j + 1] == labels[i]
            and (bounds[j + 1] - bounds[i]) <= MERGE_MAX_BARS
            and (
                labels[i] in ALWAYS_MERGE
                or abs(section_energy(j + 1) - section_energy(j)) < MERGE_ENERGY_TOL
            )
        ):
            j += 1
        best = i if i == 0 else max(range(i, j + 1), key=jump)
        kept_bounds.append(bounds[best])
        kept_labels.append(labels[i])
        i = j + 1
    return kept_bounds, kept_labels


def snap_drops_to_plateau(bounds, labels, curve, n_bars):
    out = list(bounds)
    for k, b in enumerate(out):
        if labels[k] != "drop":
            continue
        limit = out[k + 1] if k + 1 < len(out) else n_bars
        moved = 0
        while moved < DROP_SNAP_MAX_BARS and b + 1 < min(limit, len(curve)):
            ahead = curve[b + 1][1] - curve[b][1]
            here = curve[b][1] - curve[b - 1][1] if b > 0 else 0.0
            if ahead <= DROP_SNAP_RISE or ahead <= here:
                break
            b += 1
            moved += 1
        out[k] = b
    return out


def moments_from_sections(bounds, labels, rows, downbeats, bar_seconds):
    out = []
    for k, start in enumerate(bounds):
        if start >= len(downbeats):
            continue
        at = round(downbeats[start], 6)
        name = labels[k]
        if name == "drop":
            out.append({"at": at, "kind": "drop", "size": 0.95})
        elif name == "break":
            out.append({"at": at, "kind": "quiet"})
            nxt = start + 1
            if nxt < len(downbeats) and nxt < len(rows):
                bands = rows[nxt]
                top = max(range(len(bands)), key=lambda b: bands[b])
                if bands[2] > 0 and bands[0] <= bands[2] * 0.55 and top in (1, 2):
                    out.append({"at": round(downbeats[nxt], 6), "kind": "spotlight"})

        elif name == "outro":
            out.append({"at": at, "kind": "return"})
    return out


def spans_from_sections(bounds, labels, downbeats, curve, n_bars):
    spans = []
    for k, start in enumerate(bounds):
        if labels[k] != "build" or start >= len(downbeats):
            continue
        end = bounds[k + 1] if k + 1 < len(bounds) else n_bars
        end = min(end, len(downbeats) - 1)
        if end <= start:
            continue
        vals = [v for _, v in curve[start : end + 1]] or [0.0]
        spans.append(
            {
                "kind": "build",
                "from": round(downbeats[start], 6),
                "to": round(downbeats[end], 6),
                "rise": rise_shape(vals),
            }
        )
    return spans


def rise_shape(values):
    n = len(values)
    if n < 3:
        return "steady"
    lo, hi = values[0], values[-1]
    if hi - lo <= 1e-9:
        return "steady"
    mid = values[n // 2]
    halfway = (mid - lo) / (hi - lo)
    steps = sum(1 for i in range(1, n) if abs(values[i] - values[i - 1]) > 0.12)
    if steps >= max(2, n // 3):
        return "stepped"
    if halfway < 0.34:
        return "late"
    if halfway > 0.66:
        return "early"
    return "steady"


BUILD_MIN_BARS = 4
BUILD_MIN_RISE = 0.22


BUILD_BACK_MAX_BARS = 16
BUILD_BACK_MIN_BARS = 3


def builds_into_drops(curve, moments):
    if len(curve) < 4:
        return []
    times = [t for t, _ in curve]
    spans = []
    for m in moments:
        if m["kind"] != "drop":
            continue
        idx = min(range(len(times)), key=lambda i: abs(times[i] - m["at"]))
        if idx < BUILD_BACK_MIN_BARS:
            continue
        peak = curve[idx][1]
        j = idx
        while (
            j - 1 >= 0
            and idx - (j - 1) <= BUILD_BACK_MAX_BARS
            and curve[j - 1][1] <= curve[j][1] + 0.03
            and curve[j - 1][1] < peak
        ):
            j -= 1
        if idx - j < BUILD_BACK_MIN_BARS:
            continue
        spans.append({
            "kind": "build",
            "from": round(times[j], 6),
            "to": round(times[idx], 6),
            "rise": rise_shape([v for _, v in curve[j : idx + 1]]),
        })
    out = []
    for sp in sorted(spans, key=lambda s: s["from"]):
        if out and sp["from"] < out[-1]["to"]:
            continue
        out.append(sp)
    return out


def find_builds(curve, dur):
    spans, i = [], 0
    while i < len(curve) - 1:
        j = i
        while j < len(curve) - 1 and curve[j + 1][1] >= curve[j][1] - 0.04:
            j += 1
        bars = j - i
        rise = curve[j][1] - curve[i][1]
        if bars >= BUILD_MIN_BARS and rise >= BUILD_MIN_RISE:
            spans.append(
                {
                    "kind": "build",
                    "from": curve[i][0],
                    "to": curve[j][0],
                    "rise": rise_shape([v for _, v in curve[i : j + 1]]),
                }
            )
        i = j + 1 if j > i else i + 1
    return spans


def name_chapters(curve, dur):
    if not curve:
        return [{"at": 0.0, "name": "intro"}]
    chapters = [{"at": 0.0, "name": "intro"}]
    for k in range(1, len(curve)):
        t, e = curve[k]
        prev = curve[k - 1][1]
        if abs(e - prev) < 0.22:
            continue
        name = "drop" if e >= 0.7 else ("break" if e <= 0.35 else "verse")
        if chapters and t - chapters[-1]["at"] < 6.0:
            continue
        chapters.append({"at": t, "name": name})
    if dur - chapters[-1]["at"] > 8.0 and len(chapters) > 1:
        chapters.append({"at": round(curve[-1][0], 6), "name": "outro"})
    return chapters


ACCENT_ENV_HZ = 400.0
ACCENT_MIN_GAP_S = 0.045
ACCENT_ON_GRID_S = 0.05
ACCENT_FLOOR = 0.12
DRUM_OF = ("kick", "tom", "snare", "hat")


def accents_from_bands(bands, rate, beats, period, dur):
    if not bands:
        return []
    step = max(1, int(round(rate / ACCENT_ENV_HZ)))
    envs = []
    for band in bands:
        envs.append([
            max((abs(v) for v in band[i : i + step]), default=0.0)
            for i in range(0, len(band) - step + 1, step)
        ])
    erate = rate / step
    n = min(len(e) for e in envs)
    total = [sum(e[i] for e in envs) for i in range(n)]
    flux = [0.0] + [max(0.0, total[i] - total[i - 1]) for i in range(1, n)]
    peak = max(flux) or 1.0
    flux = [v / peak for v in flux]
    gap = max(1, int(ACCENT_MIN_GAP_S * erate))
    grid = sorted(beats)
    events, i = [], 1
    while i < n - 1:
        if flux[i] < ACCENT_FLOOR or flux[i] < flux[i - 1] or flux[i] < flux[i + 1]:
            i += 1
            continue
        t = i / erate
        strengths = [envs[b][i] for b in range(len(envs))]
        which = max(range(len(strengths)), key=lambda b: strengths[b])
        lo = 0
        hi = len(grid) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if grid[mid] < t:
                lo = mid + 1
            else:
                hi = mid
        near = min(
            (abs(t - grid[j]) for j in (lo - 1, lo, lo + 1) if 0 <= j < len(grid)),
            default=9.9,
        )
        events.append({
            "at": round(t, 3),
            "of": DRUM_OF[which] if which < len(DRUM_OF) else "hit",
            "strength": round(min(1.0, flux[i]), 3),
            "on_grid": near <= ACCENT_ON_GRID_S,
        })
        i += gap
    return events


def stems_from_profile(profile, beats, groups):
    index = {round(b, 3): i for i, b in enumerate(beats)}
    def run(fn):
        out = []
        for g in groups:
            i = index.get(round(g, 3))
            if i is None:
                continue
            out.append(round(fn(i), 4))
        return out
    def win(band, i):
        seg = band[i : i + 4] or [0.0]
        return sum(seg) / len(seg)
    return {
        "drums": run(lambda i: max(win(profile[0], i), win(profile[3], i))),
        "bass": run(lambda i: win(profile[1], i)),
        "other": run(lambda i: win(profile[2], i)),
    }


def sections_from(bounds, labels, groups, curve, n_bars):
    entries = []
    seen = {}
    for k, b in enumerate(bounds):
        if b >= len(groups):
            continue
        name = labels[k]
        seen[name] = seen.get(name, 0) + 1
        end = bounds[k + 1] if k + 1 < len(bounds) else n_bars
        vals = [v for _, v in curve[b:end]] or [0.0]
        entries.append({
            "at": round(groups[b], 6),
            "id": name[0].upper() + str(seen[name]) if False else name[:3].upper(),
            "repeat": seen[name],
            "arc": round(b / max(1, n_bars), 3),
            "name": name,
            "mean_energy": round(sum(vals) / len(vals), 4),
        })
    return entries


def unpulsed_map(path, dur, why):
    return {
        "map": "0.3",
        "song": {
            "title": os.path.basename(path),
            "artist": "?",
            "length": round(dur, 3),
        },
        "made_by": {"how": "model", "who": "listen/ear.py", "note": why},
        "beats": [],
        "beats_note": why,
        "downbeats": [],
        "downbeats_note": why,
        "chapters": [{"at": 0.0, "name": "intro"}],
        "moments": [],
        "spans": [],
        "confidence": 0.05,
    }


def listen(path):
    samples, sr = read_audio(path)
    dur = len(samples) / sr

    decimated, drate = block_average_decimate(samples, sr, DEC_HZ)
    kick_band = bandpass(decimated, drate, KICK_LO_HZ, KICK_HI_HZ)
    env, erate = peak_envelope(kick_band, drate, ENV_HZ)
    fx = onset_flux(env)

    period, phase, score, grid_note = fit_grid(fx, erate, dur)
    if period is not None:
        phase = refine_phase(
            fx, erate, period, phase, dur, max(1, int(round(LOOKUP_S * erate)))
        ) % period
    if period is None:
        return unpulsed_map(
            path, dur, f"no pulse found in {KICK_LO_HZ:.0f}-{KICK_HI_HZ:.0f} Hz"
        )

    beats, t = [], phase
    while t < dur:
        beats.append(round(t, 6))
        t += period
    band_signals = []
    profile = beat_band_profile(samples, sr, beats, period, keep=band_signals)
    top, cue = bar_phase(profile)
    s_top, s_cue = bar_phase_from_structure(profile)
    if s_cue >= STRUCT_MIN_CUE and s_cue > cue:
        top, cue = s_top, s_cue

    locked = cue >= BAR_CUE_FLOOR
    downbeats = beats[top::4] if locked else []
    groups = beats[(top if locked else 0) :: 4]

    curve = downbeat_energy(profile, beats, groups) if groups else []
    if curve:
        rows = bar_profile(profile, beats, groups)
        tonal = beat_tonality(samples, sr, beats, period)
        beat_index = {round(b, 3): i for i, b in enumerate(beats)}
        tonal_at_groups = [
            beat_index[round(g, 3)] for g in groups if round(g, 3) in beat_index
        ]
        tone_bar = [tonal[i] for i in tonal_at_groups] if tonal else None
        bounds = segment(rows, curve, tone_bar)
        labels = classify(rows, bounds, len(rows))
        bounds, labels = merge_runs(bounds, labels, curve, len(rows))
        bounds = snap_drops_to_plateau(bounds, labels, curve, len(rows))
        moments = (
            moments_from_sections(bounds, labels, rows, groups, period * 4)
            + find_stops(profile, beats, period)
        )
        spans = builds_into_drops(curve, moments)
        if not spans:
            spans = spans_from_sections(bounds, labels, groups, curve, len(rows))
        if not spans:
            spans = find_builds(curve, dur)
        sections = sections_from(bounds, labels, groups, curve, len(rows))
        stems = stems_from_profile(profile, beats, groups)
        accents = accents_from_bands(band_signals, keep_rate[0], beats, period, dur)
        chapters = [
            {"at": round(groups[b], 6) if b else 0.0, "name": labels[i]}
            for i, b in enumerate(bounds)
            if b < len(groups)
        ]
    else:
        moments, spans = find_stops(profile, beats, period), []
        tonal, tonal_at_groups = [], []
        sections, stems, accents = [], {}, []
        chapters = [{"at": 0.0, "name": "intro"}]
    moments.sort(key=lambda x: x["at"])

    m = {
        "map": "0.3",
        "song": {
            "title": os.path.basename(path),
            "artist": "?",
            "length": round(dur, 3),
        },
        "made_by": {
            "how": "model",
            "who": "listen/ear.py",
            "note": "low-band comb fit, octave decided by added-beat support",
        },
        "grid": {
            "period": round(period, 6),
            "phase": round(phase, 6),
            "bpm": round(60.0 / period, 3),
            "bar_phase": (top + 1) if locked else None,
            "locked": locked,
            "how": f"onset flux {KICK_LO_HZ:.0f}-{KICK_HI_HZ:.0f} Hz, comb search, octave-tested",
        },
        "beats": beats,
        "downbeats": downbeats,
        "chapters": chapters,
        "moments": moments,
        "spans": spans,
        "energy": curve,
        "sections": {
            "note": "Which sections are the same section, so a reader can make the "
                    "second one bigger than the first.",
            "how": "boundaries from beat-synchronous band novelty, labelled by kick "
                   "presence and energy rank; repeat counts occurrences of a label",
            "entries": sections,
        },
        "stems": {
            "model": "band-energy proxy, not source separation",
            "rate": "per_downbeat",
            "note": "drums/bass/other estimated from 35-130, 130-400 and 400-1200 Hz. "
                    "vocals and guitar are absent because this cannot separate them.",
            "sources": stems,
        },
        "accents": {
            "of": "percussive hits",
            "how": f"peaks in summed band onset flux at {ACCENT_ENV_HZ:.0f} Hz, "
                   f"labelled by which band dominates, on_grid within "
                   f"{ACCENT_ON_GRID_S*1000:.0f} ms of a beat",
            "note": "the band label is a guess at which drum; the time is measured",
            "events": accents,
        },
        "observations": {
            "tonality": {
                "rate": "per_beat",
                "unit": "0-1, 1 = strongly pitched and sustained",
                "how": f"1 - spectral flatness over {TON_LO_HZ:.0f}-{TON_HI_HZ:.0f} Hz, "
                       f"{TON_N}-point window, normalised across the song",
                "not": "not loudness -- this rises when a pitched instrument carries "
                       "the music, which on a real record often happens as energy falls",
                "at": [t for t, _ in curve],
                "value": [round(tonal[i], 4) for i in tonal_at_groups] if tonal else [],
            }
        },
        "confidence": round(min(0.95, max(0.05, cue)), 3),
        "confidence_by_field": {
            "beats": round(min(0.95, 0.5 + score * 4), 3),
            "downbeats": round(cue, 3) if locked else 0.0,
            "chapters": 0.45 if curve else 0.0,
            "moments": 0.5 if curve else 0.0,
            "spans": 0.4 if spans else 0.0,
            "energy": 0.7 if curve else 0.0,
        },
    }
    if grid_note:
        m["grid"]["octave_note"] = grid_note
    if not locked:
        m["downbeats_note"] = (
            f"bar cue strength {cue:.3f} below {BAR_CUE_FLOOR} -- the audio "
            f"carries no bar accent, so downbeats are left empty, not guessed"
        )
    return m


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(USAGE)
        sys.exit(2)
    print(json.dumps(listen(sys.argv[-1]), indent=1))
