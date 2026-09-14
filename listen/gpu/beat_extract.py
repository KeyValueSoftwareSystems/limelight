import os, json, time, glob, warnings
import numpy as np

warnings.filterwarnings("ignore")

WAV_DIR = os.environ.get("WAV_DIR", "work/wav")
OUT_DIR = os.environ.get("OUT_DIR", "work/beats")
os.makedirs(OUT_DIR, exist_ok=True)

USE_BEATNET = True
USE_MADMOM = True
USE_BEAT_THIS = True

try:
    from BeatNet.BeatNet import BeatNet
except ImportError:
    print("BeatNet not available, skipping", flush=True)
    USE_BEATNET = False

try:
    import madmom
except ImportError:
    print("madmom not available, skipping", flush=True)
    USE_MADMOM = False

try:
    from beat_this.inference import File2Beats
except ImportError:
    print("beat_this not available, skipping", flush=True)
    USE_BEAT_THIS = False


def extract_beatnet(wav_path):
    estimator = BeatNet(1, mode="offline", inference_model="DBN", plot=[], thread=False)
    output = estimator.process(wav_path)
    beats, downbeats = [], []
    for row in output:
        t = float(row[0])
        is_down = int(row[1]) == 1
        beats.append(t)
        if is_down:
            downbeats.append(t)
    return beats, downbeats


def extract_madmom(wav_path):
    proc = madmom.features.RNNDownBeatProcessor()(wav_path)
    result = madmom.features.DBNDownBeatTrackingProcessor(
        beats_per_bar=[3, 4], fps=100
    )(proc)
    beats, downbeats = [], []
    for row in result:
        t = float(row[0])
        beat_pos = int(row[1])
        beats.append(t)
        if beat_pos == 1:
            downbeats.append(t)
    return beats, downbeats


def extract_beat_this(wav_path):
    f2b = File2Beats(device="cuda", dbn=True)
    beats, downbeats = f2b(wav_path)
    return beats.tolist(), downbeats.tolist()


def median_tempo(beats):
    if len(beats) < 3:
        return 0
    intervals = np.diff(beats)
    intervals = intervals[(intervals > 0.2) & (intervals < 2.0)]
    if len(intervals) == 0:
        return 0
    return round(60.0 / float(np.median(intervals)), 1)


def consensus_beats(all_beats, tolerance_ms=50):
    if not all_beats:
        return []
    tol = tolerance_ms / 1000.0
    all_times = sorted(set(t for beats in all_beats for t in beats))
    clusters = []
    used = set()
    for t in all_times:
        if t in used:
            continue
        cluster = [t]
        used.add(t)
        for t2 in all_times:
            if t2 not in used and abs(t2 - t) < tol:
                cluster.append(t2)
                used.add(t2)
        clusters.append(round(float(np.mean(cluster)), 3))
    return sorted(clusters)


if __name__ == "__main__":
    wavs = sorted(glob.glob(os.path.join(WAV_DIR, "*.wav")))
    trackers = []
    if USE_BEATNET:
        trackers.append("beatnet")
    if USE_MADMOM:
        trackers.append("madmom")
    if USE_BEAT_THIS:
        trackers.append("beat_this")
    print(f"Beat extraction: {len(wavs)} songs, trackers: {trackers}", flush=True)

    for i, wav in enumerate(wavs):
        slug = os.path.splitext(os.path.basename(wav))[0]
        out_path = os.path.join(OUT_DIR, f"{slug}.json")
        if os.path.exists(out_path):
            print(f"[{i + 1}/{len(wavs)}] {slug} -- skip", flush=True)
            continue

        t0 = time.time()
        print(f"[{i + 1}/{len(wavs)}] {slug}...", flush=True)
        result = {"slug": slug, "trackers": {}}

        if USE_BEATNET:
            try:
                b, d = extract_beatnet(wav)
                result["trackers"]["beatnet"] = {
                    "beats": b,
                    "downbeats": d,
                    "tempo_bpm": median_tempo(b),
                    "beat_count": len(b),
                    "downbeat_count": len(d),
                }
                print(f"  beatnet: {len(b)} beats, {median_tempo(b)} BPM", flush=True)
            except Exception as e:
                print(f"  beatnet FAIL: {e}", flush=True)

        if USE_MADMOM:
            try:
                b, d = extract_madmom(wav)
                result["trackers"]["madmom"] = {
                    "beats": b,
                    "downbeats": d,
                    "tempo_bpm": median_tempo(b),
                    "beat_count": len(b),
                    "downbeat_count": len(d),
                }
                print(f"  madmom: {len(b)} beats, {median_tempo(b)} BPM", flush=True)
            except Exception as e:
                print(f"  madmom FAIL: {e}", flush=True)

        if USE_BEAT_THIS:
            try:
                b, d = extract_beat_this(wav)
                result["trackers"]["beat_this"] = {
                    "beats": b,
                    "downbeats": d,
                    "tempo_bpm": median_tempo(b),
                    "beat_count": len(b),
                    "downbeat_count": len(d),
                }
                print(f"  beat_this: {len(b)} beats, {median_tempo(b)} BPM", flush=True)
            except Exception as e:
                print(f"  beat_this FAIL: {e}", flush=True)

        all_beat_lists = [t["beats"] for t in result["trackers"].values()]
        all_down_lists = [t["downbeats"] for t in result["trackers"].values()]
        result["consensus_beats"] = consensus_beats(all_beat_lists)
        result["consensus_downbeats"] = consensus_beats(all_down_lists, tolerance_ms=80)

        tempos = [
            t["tempo_bpm"] for t in result["trackers"].values() if t["tempo_bpm"] > 0
        ]
        result["consensus_tempo_bpm"] = (
            round(float(np.median(tempos)), 1) if tempos else 0
        )

        n_trackers = len(result["trackers"])
        if n_trackers >= 2:
            agreements = []
            tracker_names = list(result["trackers"].keys())
            for a_idx in range(len(tracker_names)):
                for b_idx in range(a_idx + 1, len(tracker_names)):
                    a_beats = result["trackers"][tracker_names[a_idx]]["beats"]
                    b_beats = result["trackers"][tracker_names[b_idx]]["beats"]
                    matched = 0
                    for bt in a_beats:
                        if any(abs(bt - bt2) < 0.05 for bt2 in b_beats):
                            matched += 1
                    if a_beats:
                        agreements.append(matched / len(a_beats))
            result["agreement_score"] = round(float(np.mean(agreements)), 3)

        result["time_s"] = round(time.time() - t0, 1)
        with open(out_path, "w") as f:
            json.dump(result, f, indent=2)
        print(
            f"  consensus: {len(result['consensus_beats'])} beats, {result['consensus_tempo_bpm']} BPM, {time.time() - t0:.0f}s",
            flush=True,
        )

    print("BEAT_EXTRACT_DONE", flush=True)
