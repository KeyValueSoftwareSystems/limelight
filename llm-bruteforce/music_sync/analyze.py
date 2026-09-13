#!/usr/bin/env python3
"""Analyse a music file and render a light-frame stream for the RGB PAR.

  analyze.py "The Nights.mp3" [--fps 40] [--style pulse|bands|concert]

Writes next to the track:
  <name>.lights.json   the stream: fps, one frame per row (3 ch for pulse/bands, 41 ch for
                       the universe-0 concert rig), beats, downbeats, sections, phases
  <name>.cache.wav     decoded audio, played back by play.py / server.py
"""
import argparse
import json
import os
import sys

import numpy as np
import librosa
import soundfile as sf

from mapping import render_pulse, render_bands
import phases as phase_mod
import concert

ANALYSIS_SR = 22050
HOP = 512
BAND_EDGES_HZ = (200.0, 2000.0)        # bass | mid | treble
LOUDNESS_RANGE_DB = 35.0
BAND_RANGE_DB = 30.0
SECTION_SECONDS = 30.0                 # target section length for segmentation


# ---------------------------------------------------------------- audio I/O

def load_audio(path):
    """Full-quality audio for playback (frames x channels) plus mono analysis signal."""
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if sr != ANALYSIS_SR:
        mono = librosa.resample(mono, orig_sr=sr, target_sr=ANALYSIS_SR)
    return data, sr, mono


def write_cache_wav(data, sr, path):
    sf.write(path, data, sr, subtype="PCM_16")


# ---------------------------------------------------------------- features

def _to_grid(times, values, grid_t):
    values = np.asarray(values, dtype=float)
    if values.ndim == 1:
        return np.interp(grid_t, times, values)
    return np.stack([np.interp(grid_t, times, values[:, j]) for j in range(values.shape[1])], axis=1)


def _db_norm(power, ref_db, range_db):
    db = 10 * np.log10(np.maximum(power, 1e-12))
    return np.clip((db - (ref_db - range_db)) / range_db, 0, 1)


def _smooth(x, fps, seconds):
    w = max(1, int(round(seconds * fps)))
    if w <= 1:
        return x
    kernel = np.ones(w) / w
    pad = np.pad(x, (w // 2, w - 1 - w // 2), mode="edge")
    return np.convolve(pad, kernel, mode="valid")


def _downbeats(beats, onset_env, sr, hop):
    """Pick the beat phase (0..3) whose beats carry the most onset energy."""
    if len(beats) < 4:
        return list(beats[:1])
    frames = librosa.time_to_frames(beats, sr=sr, hop_length=hop)
    frames = np.clip(frames, 0, len(onset_env) - 1)
    strength = onset_env[frames]
    phase = int(np.argmax([strength[p::4].mean() for p in range(4)]))
    return [float(b) for b in beats[phase::4]]


def _offbeat_onsets(y, sr, hop, onset_env, beats, period):
    """Strong hits that are not on a beat: (time, strength 0..1)."""
    if len(onset_env) == 0 or period <= 0:
        return []
    frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop, units="frames")
    if len(frames) == 0:
        return []
    times = librosa.frames_to_time(frames, sr=sr, hop_length=hop)
    ref = np.percentile(onset_env, 99) or 1.0
    strengths = np.clip(onset_env[frames] / ref, 0, 1)
    beats = np.asarray(beats, dtype=float)
    out = []
    for t, s in zip(times, strengths):
        dist = np.min(np.abs(beats - t)) if len(beats) else np.inf
        if dist > 0.25 * period and s > 0.5:
            out.append((float(t), float(s)))
    return out


def _sections(y, sr, hop, duration, downbeats):
    """Coarse structural boundaries (verse/chorus), snapped to downbeats."""
    k = int(max(2, round(duration / SECTION_SECONDS)))
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=hop, n_mfcc=13)
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=hop, tuning=0.0)
    feats = np.vstack([librosa.util.normalize(mfcc, axis=1), librosa.util.normalize(chroma, axis=1)])
    # smooth over ~1 s so bar-level detail does not fragment the segmentation
    win = max(1, int(sr / hop))
    kernel = np.ones(win) / win
    feats = np.stack([np.convolve(row, kernel, mode="same") for row in feats])
    if feats.shape[1] <= k:
        return [0.0]
    bounds = librosa.segment.agglomerative(feats, k)
    times = librosa.frames_to_time(bounds, sr=sr, hop_length=hop)
    db = np.asarray(downbeats, dtype=float)
    out = [0.0]
    for t in times[1:]:
        snapped = float(db[np.argmin(np.abs(db - t))]) if len(db) else float(t)
        if snapped - out[-1] >= 4.0 and snapped < duration - 4.0:
            out.append(snapped)
    return out


def choose_palettes(section_tilts):
    """Warm palettes (0, 3) for bass-heavy sections, cool (1, 2) for bright ones,
    alternating within a family so consecutive same-family sections differ."""
    warm, cool = [0, 3], [1, 2]
    tilts = np.asarray(section_tilts, dtype=float)
    pivot = np.median(tilts) if len(tilts) > 1 else 0.0
    out, wi, ci = [], 0, 0
    for t in tilts:
        if t <= pivot:
            out.append(warm[wi % 2]); wi += 1
        else:
            out.append(cool[ci % 2]); ci += 1
    return out


def extract_features(y, sr, fps):
    duration = len(y) / sr
    n = int(np.ceil(duration * fps))
    grid_t = np.arange(n) / fps

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, onset_envelope=onset_env,
                                           hop_length=HOP, units="time")
    tempo = float(np.atleast_1d(tempo)[0]) if np.size(tempo) else 0.0
    beats = [float(b) for b in beats]
    tempo, beats = halve_if_double_time(tempo, beats, onset_env, sr)
    period = float(np.median(np.diff(beats))) if len(beats) >= 2 else (60.0 / tempo if tempo else 0.5)
    downbeats = _downbeats(np.asarray(beats), onset_env, sr, HOP)
    onsets = _offbeat_onsets(y, sr, HOP, onset_env, beats, period)

    # frame-rate features on librosa's hop grid, then interpolated to fps
    S = np.abs(librosa.stft(y, hop_length=HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=sr)
    ft = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=HOP)

    rms = np.sqrt(S.mean(axis=0))
    ref_db = 20 * np.log10(max(np.percentile(rms, 99), 1e-9))
    loud_db = 20 * np.log10(np.maximum(rms, 1e-9))
    loudness = np.clip((loud_db - (ref_db - LOUDNESS_RANGE_DB)) / LOUDNESS_RANGE_DB, 0, 1)
    loudness = _smooth(_to_grid(ft, loudness, grid_t), fps, 0.3)

    lo, hi = BAND_EDGES_HZ
    band_power = np.stack([S[freqs < lo].sum(0), S[(freqs >= lo) & (freqs < hi)].sum(0), S[freqs >= hi].sum(0)], axis=1)
    p99 = 10 * np.log10(np.maximum(np.percentile(band_power, 99, axis=0), 1e-12))
    ref = np.maximum(p99, p99.max() - 20)
    bands = np.stack([_db_norm(band_power[:, j], ref[j], BAND_RANGE_DB) for j in range(3)], axis=1)
    bands = _to_grid(ft, bands, grid_t)

    centroid = librosa.feature.spectral_centroid(S=S, sr=sr)[0]
    tilt = np.clip((np.log2(np.maximum(centroid, 20.0)) - np.log2(1000.0)) / 2.0, -1, 1)
    tilt = _to_grid(ft, tilt, grid_t)

    sections = _sections(y, sr, HOP, duration, downbeats)
    bar_bass, bar_loud = bar_features(y, sr, downbeats)
    all_onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=HOP, units="time")
    bar_ons = bar_onsets(all_onsets, downbeats)
    sec_idx = np.searchsorted(np.asarray(sections), grid_t, side="right") - 1
    section_tilts = [float(tilt[sec_idx == i].mean()) if np.any(sec_idx == i) else 0.0
                     for i in range(len(sections))]

    return {
        "duration": duration,
        "tempo": tempo,
        "beats": beats,
        "downbeats": downbeats,
        "onsets": onsets,
        "sections": sections,
        "palette_indices": choose_palettes(section_tilts),
        "bar_bass": bar_bass,
        "bar_loud": bar_loud,
        "bar_onsets": bar_ons,
        "loudness": loudness,
        "bands": bands,
        "tilt": tilt,
    }


def bar_onsets(onset_times, downbeats):
    """Onset count per bar (how much the beat is 'in')."""
    db = list(downbeats)
    if len(db) < 2:
        return np.zeros(0)
    edges = db + [db[-1] + float(np.median(np.diff(db)))]
    on = np.asarray(onset_times, float)
    return np.array([np.sum((on >= s) & (on < e)) for s, e in zip(edges[:-1], edges[1:])], float)


def bar_features(y, sr, downbeats):
    """Per-bar bass (<150 Hz) and total energy in dB relative to the loudest bar."""
    S = np.abs(librosa.stft(y, hop_length=HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=sr)
    ft = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=HOP)
    tot = 10 * np.log10(S.sum(0) + 1e-12)
    bass = 10 * np.log10(S[freqs < 150].sum(0) + 1e-12)
    db = list(downbeats)
    if len(db) < 2:
        return np.zeros(0), np.zeros(0)
    edges = db + [db[-1] + float(np.median(np.diff(db)))]
    b, l = [], []
    for s, e in zip(edges[:-1], edges[1:]):
        m = (ft >= s) & (ft < e)
        b.append(bass[m].mean() if m.any() else -60.0)
        l.append(tot[m].mean() if m.any() else -60.0)
    b, l = np.array(b), np.array(l)
    return b - b.max(), l - l.max()


def halve_if_double_time(tempo, beats, onset_env, sr):
    """Beat trackers often lock to 180 for a 90 BPM track; keep the stronger half."""
    if tempo <= 140 or len(beats) < 8:
        return tempo, beats
    frames = np.clip(librosa.time_to_frames(beats, sr=sr, hop_length=HOP), 0, len(onset_env) - 1)
    strength = onset_env[frames]
    ph = int(np.argmax([strength[p::2].mean() for p in range(2)]))
    return tempo / 2, [float(b) for b in beats[ph::2]]


# ---------------------------------------------------------------- output

def render(features, fps, style):
    if style == "bands":
        return render_bands(features, fps)
    if style == "concert":
        return render_concert(features, fps)[0]
    return render_pulse(features, fps)


def render_concert(features, fps):
    """41-channel frames for the universe-0 rig from detected beats and bar labels."""
    grid = concert.BeatList(features["beats"], features["downbeats"])
    labels = phase_mod.label_bars(features["bar_bass"], features["bar_loud"], features.get("bar_onsets"))
    ph = phase_mod.phases_from_labels(features["downbeats"][: len(labels)], labels, features["duration"])
    tl = concert.Timeline(grid=grid, phases=ph)
    frames, meta = concert.render(tl, fps=fps)
    return frames, ph


def write_lights_json(path, features, frames, fps, source, style, wav, phases=None):
    doc = {
        "rig": "universe0-4par-head" if style == "concert" else None,
        "phases": phases or [],
        "source": source,
        "wav": wav,
        "style": style,
        "fps": fps,
        "duration": features["duration"],
        "tempo": features.get("tempo"),
        "beats": [round(t, 4) for t in features.get("beats", [])],
        "downbeats": [round(t, 4) for t in features.get("downbeats", [])],
        "sections": [round(t, 4) for t in features.get("sections", [])],
        "frames": np.asarray(frames, dtype=int).tolist(),
    }
    with open(path, "w") as fh:
        json.dump(doc, fh)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("track")
    ap.add_argument("--fps", type=int, default=40)
    ap.add_argument("--style", choices=["pulse", "bands", "concert"], default="pulse")
    args = ap.parse_args(argv)

    base = os.path.splitext(args.track)[0]
    json_path, wav_path = base + ".lights.json", base + ".cache.wav"

    print(f"decoding {args.track!r} ...", flush=True)
    data, sr, mono = load_audio(args.track)
    write_cache_wav(data, sr, wav_path)
    print(f"analysing {len(mono) / ANALYSIS_SR:.1f} s of audio ...", flush=True)
    feats = extract_features(mono, ANALYSIS_SR, args.fps)
    phases = None
    if args.style == "concert":
        frames, phases = render_concert(feats, args.fps)
    else:
        frames = render(feats, args.fps, args.style)
    write_lights_json(json_path, feats, frames, args.fps, os.path.basename(args.track),
                      args.style, os.path.basename(wav_path), phases)
    if phases:
        for p in phases:
            print(f"  {int(p['start'] // 60)}:{p['start'] % 60:05.2f}-{int(p['end'] // 60)}:{p['end'] % 60:05.2f}  {p['phase']}")

    print(f"tempo {feats['tempo']:.1f} BPM, {len(feats['beats'])} beats, "
          f"{len(feats['downbeats'])} downbeats, {len(feats['onsets'])} off-beat hits")
    print("sections at " + ", ".join(f"{t:.1f}s" for t in feats["sections"])
          + f"  palettes {feats['palette_indices']}")
    print(f"wrote {json_path} ({len(frames)} frames @ {args.fps} fps) and {wav_path}")


if __name__ == "__main__":
    main()
