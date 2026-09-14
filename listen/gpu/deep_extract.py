import os, json, time, glob, warnings
import numpy as np

warnings.filterwarnings("ignore")

import librosa

CASCADE_DIR = os.environ.get("CASCADE_DIR", "work/stems-cascade")
WAV_DIR = os.environ.get("WAV_DIR", "work/wav")
OUT_DIR = os.environ.get("OUT_DIR", "work/deep-features")
os.makedirs(OUT_DIR, exist_ok=True)

SR = 22050
HOP = 512
FRAME_S = HOP / SR

STEMS = ["vocals", "bass", "drums", "guitar", "piano", "other"]
MELODIC = ["vocals", "bass", "guitar", "piano"]


def rms_envelope(y, hop=HOP):
    return librosa.feature.rms(y=y, hop_length=hop)[0]


def onsets(y, sr=SR, hop=HOP):
    oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    frames = librosa.onset.onset_detect(
        onset_envelope=oenv, sr=sr, hop_length=hop, backtrack=True
    )
    return librosa.frames_to_time(frames, sr=sr, hop_length=hop).tolist()


def pitch_track(y, sr=SR):
    f0, voiced, _ = librosa.pyin(y, fmin=50, fmax=2000, sr=sr, hop_length=HOP)
    times = librosa.times_like(f0, sr=sr, hop_length=HOP)
    notes = []
    current_note = None
    for t, freq, v in zip(times, f0, voiced):
        if v and not np.isnan(freq):
            midi = int(round(librosa.hz_to_midi(freq)))
            name = librosa.midi_to_note(midi)
            if current_note is None or current_note["midi"] != midi:
                if current_note:
                    current_note["end"] = round(float(t), 3)
                    notes.append(current_note)
                current_note = {
                    "start": round(float(t), 3),
                    "midi": midi,
                    "note": name,
                    "hz": round(float(freq), 1),
                }
            else:
                current_note["end"] = round(float(t), 3)
        else:
            if current_note:
                current_note["end"] = round(float(t), 3)
                notes.append(current_note)
                current_note = None
    if current_note:
        current_note["end"] = round(float(times[-1]), 3)
        notes.append(current_note)
    return [n for n in notes if n["end"] - n["start"] >= 0.05]


def drum_patterns(y, sr=SR):
    S = np.abs(librosa.stft(y, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=sr)

    kick_mask = (freqs >= 30) & (freqs <= 150)
    snare_mask = (freqs >= 150) & (freqs <= 500)
    hihat_mask = (freqs >= 5000) & (freqs <= 15000)

    kick_env = S[kick_mask].sum(axis=0)
    snare_env = S[snare_mask].sum(axis=0)
    hihat_env = S[hihat_mask].sum(axis=0)

    def detect_hits(env, threshold_factor=2.5):
        if env.max() == 0:
            return []
        env = env / env.max()
        peaks = []
        mean_e = env.mean()
        for i in range(1, len(env) - 1):
            if (
                env[i] > env[i - 1]
                and env[i] > env[i + 1]
                and env[i] > mean_e * threshold_factor
            ):
                t = librosa.frames_to_time(i, sr=sr, hop_length=HOP)
                peaks.append(round(float(t), 3))
        filtered = []
        for p in peaks:
            if not filtered or p - filtered[-1] > 0.05:
                filtered.append(p)
        return filtered

    return {
        "kick": detect_hits(kick_env, 2.0),
        "snare": detect_hits(snare_env, 2.5),
        "hihat": detect_hits(hihat_env, 2.0),
    }


def spectral_features(y, sr=SR):
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=HOP)[0]
    bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr, hop_length=HOP)[0]
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, hop_length=HOP)[0]
    flatness = librosa.feature.spectral_flatness(y=y, hop_length=HOP)[0]
    return {
        "brightness_mean": round(float(np.nanmean(centroid)), 1),
        "brightness_std": round(float(np.nanstd(centroid)), 1),
        "bandwidth_mean": round(float(np.nanmean(bandwidth)), 1),
        "rolloff_mean": round(float(np.nanmean(rolloff)), 1),
        "flatness_mean": round(float(np.nanmean(flatness)), 4),
    }


def key_per_segment(y, sr=SR, seg_s=10):
    keys = []
    n_samples = len(y)
    seg_len = seg_s * sr
    key_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    major_prof = np.array(
        [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
    )
    minor_prof = np.array(
        [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
    )

    for start in range(0, n_samples, seg_len):
        chunk = y[start : start + seg_len]
        if len(chunk) < sr:
            break
        chroma = librosa.feature.chroma_cqt(y=chunk, sr=sr, hop_length=HOP)
        profile = chroma.mean(axis=1)

        best_corr = -1
        best_key = "C"
        best_mode = "major"
        for shift in range(12):
            rolled = np.roll(profile, -shift)
            for mode, prof_template in [("major", major_prof), ("minor", minor_prof)]:
                corr = float(np.corrcoef(rolled, prof_template)[0, 1])
                if corr > best_corr:
                    best_corr = corr
                    best_key = key_names[shift]
                    best_mode = mode

        keys.append(
            {
                "start": round(start / sr, 2),
                "end": round(min(start + seg_len, n_samples) / sr, 2),
                "key": best_key,
                "mode": best_mode,
                "confidence": round(best_corr, 3),
            }
        )
    return keys


def activity_map(stem_rms):
    threshold = np.percentile(stem_rms, 30)
    active = stem_rms > threshold
    window = int(2.0 / FRAME_S)
    windows = []
    for start in range(0, len(active), window):
        chunk = active[start : start + window]
        windows.append(
            {"t": round(start * FRAME_S, 2), "active": round(float(chunk.mean()), 3)}
        )
    return windows


def energy_profile(y_full, sr=SR, seg_s=5):
    segments = []
    n = len(y_full)
    seg_len = seg_s * sr
    for start in range(0, n, seg_len):
        chunk = y_full[start : start + seg_len]
        if len(chunk) < sr:
            break
        rms = float(np.sqrt(np.mean(chunk**2)))
        db = round(float(librosa.amplitude_to_db(np.array([rms]))[0]), 1)
        peak = round(float(np.max(np.abs(chunk))), 4)
        segments.append(
            {
                "start": round(start / sr, 2),
                "end": round(min(start + seg_len, n) / sr, 2),
                "rms_db": db,
                "peak": peak,
            }
        )
    return segments


def vocal_characteristics(notes):
    if not notes:
        return {}
    midis = [n["midi"] for n in notes]
    return {
        "pitch_range_low": librosa.midi_to_note(min(midis)),
        "pitch_range_high": librosa.midi_to_note(max(midis)),
        "pitch_range_semitones": max(midis) - min(midis),
        "avg_note_duration_s": round(
            float(np.mean([n["end"] - n["start"] for n in notes])), 3
        ),
        "total_notes": len(notes),
        "most_common_note": librosa.midi_to_note(int(round(np.median(midis)))),
    }


def process_song(slug):
    stem_dir = os.path.join(CASCADE_DIR, slug)
    wav_path = os.path.join(WAV_DIR, f"{slug}.wav")

    if not os.path.isdir(stem_dir):
        return None

    result = {"slug": slug, "stems": {}}

    y_full, _ = librosa.load(wav_path, sr=SR, mono=True)
    duration = len(y_full) / SR

    result["duration_s"] = round(duration, 2)
    result["energy_profile"] = energy_profile(y_full)
    result["key_sections"] = key_per_segment(y_full, seg_s=15)

    for stem_name in STEMS:
        sp = os.path.join(stem_dir, f"{stem_name}.wav")
        if not os.path.exists(sp):
            continue

        y, _ = librosa.load(sp, sr=SR, mono=True)
        rms = rms_envelope(y)

        stem_data = {
            "spectral": spectral_features(y),
            "onset_count": len(onsets(y)),
            "onsets": onsets(y)[:500],
            "activity": activity_map(rms),
            "energy_mean_db": round(
                float(librosa.amplitude_to_db(np.array([np.sqrt(np.mean(y**2))]))[0]), 1
            ),
        }

        if stem_name in MELODIC:
            notes = pitch_track(y)
            stem_data["notes"] = notes[:1000]
            stem_data["note_count"] = len(notes)
            if stem_name == "vocals":
                stem_data["vocal_characteristics"] = vocal_characteristics(notes)

        if stem_name == "drums":
            stem_data["drum_hits"] = drum_patterns(y)
            kicks = stem_data["drum_hits"]["kick"]
            snares = stem_data["drum_hits"]["snare"]
            hihats = stem_data["drum_hits"]["hihat"]
            stem_data["drum_summary"] = {
                "kick_count": len(kicks),
                "snare_count": len(snares),
                "hihat_count": len(hihats),
            }
            if len(kicks) > 3:
                intervals = np.diff(kicks)
                median_interval = float(np.median(intervals))
                if median_interval > 0:
                    stem_data["drum_summary"]["kick_bpm_est"] = round(
                        60.0 / median_interval, 1
                    )

        result["stems"][stem_name] = stem_data

    dominance = []
    for seg in result["energy_profile"]:
        seg_dom = {"start": seg["start"], "end": seg["end"]}
        seg_energies = {}
        for sn in STEMS:
            if sn in result["stems"]:
                acts = result["stems"][sn]["activity"]
                matching = [
                    a for a in acts if a["t"] >= seg["start"] and a["t"] < seg["end"]
                ]
                if matching:
                    seg_energies[sn] = round(
                        float(np.mean([a["active"] for a in matching])), 3
                    )
        if seg_energies:
            ranked = sorted(seg_energies.items(), key=lambda x: -x[1])
            seg_dom["dominant"] = ranked[0][0]
            seg_dom["mix"] = dict(ranked)
        dominance.append(seg_dom)
    result["instrument_dominance"] = dominance

    return result


if __name__ == "__main__":
    songs = sorted(os.listdir(CASCADE_DIR))
    songs = [s for s in songs if os.path.isdir(os.path.join(CASCADE_DIR, s))]
    print(f"Deep-extracting features from {len(songs)} songs...", flush=True)

    for i, slug in enumerate(songs):
        out_path = os.path.join(OUT_DIR, f"{slug}.json")
        if os.path.exists(out_path):
            print(f"[{i + 1}/{len(songs)}] {slug} — skip", flush=True)
            continue

        t0 = time.time()
        print(f"[{i + 1}/{len(songs)}] {slug} — extracting...", flush=True)
        try:
            features = process_song(slug)
            if features:
                with open(out_path, "w") as f:
                    json.dump(features, f, indent=1, ensure_ascii=False)
                n_stems = len(features["stems"])
                n_notes = sum(
                    s.get("note_count", 0) for s in features["stems"].values()
                )
                n_onsets = sum(
                    s.get("onset_count", 0) for s in features["stems"].values()
                )
                print(
                    f"  OK in {time.time() - t0:.0f}s: {n_stems} stems, {n_notes} notes, {n_onsets} onsets",
                    flush=True,
                )
            else:
                print(f"  SKIP: no stems found", flush=True)
        except Exception as e:
            print(f"  FAIL: {e}", flush=True)
            import traceback

            traceback.print_exc()

    print("DEEP_EXTRACT_DONE", flush=True)
