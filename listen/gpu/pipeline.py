#!/usr/bin/env python3
import os, sys, json, time, re, glob, math, warnings, gc

warnings.filterwarnings("ignore")
os.environ.setdefault("BASIC_PITCH_MODEL_TYPE", "onnx")

from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

BASE = os.path.dirname(os.path.abspath(__file__))
SCORE_OUT = os.path.join(BASE, "score-out")
os.makedirs(SCORE_OUT, exist_ok=True)
SGLANG_URL = os.environ.get("SGLANG_URL", "http://localhost:30000")
sglang_lock = threading.Lock()

import subprocess, signal


def stop_sglang():
    print("    [stopping SGLang to free GPU...]", flush=True)
    os.system('pkill -f "sglang.launch_server" 2>/dev/null')
    import time as _t

    _t.sleep(3)
    import torch

    torch.cuda.empty_cache()
    gc.collect()


def start_sglang():
    print("    [restarting SGLang...]", flush=True)
    venv_bin = os.path.dirname(os.path.abspath(sys.executable))
    env = dict(os.environ, SGLANG_DISABLE_CUDNN_CHECK="1")
    env["PATH"] = venv_bin + ":" + env.get("PATH", "")
    subprocess.Popen(
        [
            sys.executable,
            "-m",
            "sglang.launch_server",
            "--model-path",
            os.path.join(BASE, "moss-thinking"),
            "--host",
            "0.0.0.0",
            "--port",
            "30000",
            "--tp",
            "1",
            "--chat-template",
            os.path.join(BASE, "moss-thinking/chat_template.jinja"),
            "--trust-remote-code",
        ],
        env=env,
        stdout=open("/dev/null", "w"),
        stderr=open("/dev/null", "w"),
        cwd=BASE,
    )
    import time as _t, requests as _r

    for i in range(120):
        _t.sleep(2)
        try:
            resp = _r.get(f"{SGLANG_URL}/health", timeout=2)
            if resp.status_code == 200:
                print(f"    [SGLang ready after {(i + 1) * 2}s]", flush=True)
                return True
        except:
            pass
    print("    [SGLang failed to start!]", flush=True)
    return False


sys.path.insert(0, os.path.join(BASE, "msst"))

ALL_STEMS = [
    "accordion",
    "acoustic-guitar",
    "back-vocal",
    "banjo",
    "bass",
    "bassoon",
    "bells",
    "bowed_strings",
    "brass",
    "cello",
    "clarinet",
    "congas",
    "digital-piano",
    "dobro",
    "double-bass",
    "drums",
    "electric-guitar",
    "flute",
    "french-horn",
    "glockenspiel",
    "guitar",
    "harmonica",
    "harp",
    "harpsichord",
    "hh",
    "keys",
    "kick",
    "lead-vocal",
    "mandolin",
    "marimba",
    "oboe",
    "organ",
    "percussion",
    "piano",
    "saxophone",
    "sitar",
    "snare",
    "strings",
    "synth",
    "tambourine",
    "timpani",
    "toms",
    "triangle",
    "trombone",
    "trumpet",
    "tuba",
    "ukulele",
    "viola",
    "violin",
    "vocal",
    "wind",
    "wind-chimes",
    "woodwind",
]

SECTION_NORMALIZE = {
    "inst": "instrumental",
    "inst.": "instrumental",
    "pre chorus": "pre-chorus",
    "prechorus": "pre-chorus",
    "post chorus": "post-chorus",
    "postchorus": "post-chorus",
    "break": "breakdown",
    "build-up": "buildup",
    "build up": "buildup",
}


def norm_label(label):
    label = re.sub(r"\s*\d+$", "", label.strip().lower())
    return SECTION_NORMALIZE.get(label, label)


def strip_think(text):
    if not text or not isinstance(text, str):
        return ""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    if "<think>" in text:
        idx = text.find("\n\n")
        if idx >= 0:
            text = text[idx:].strip()
        else:
            text = re.sub(r"<think>.*", "", text, flags=re.DOTALL).strip()
    text = re.sub(r"\*\*[^*]+\*\*\s*", "", text).strip()
    return text


def clean_sections(sections):
    if not sections:
        return []
    out = []
    for s in sections:
        label = s.get("label") or s.get("type") or s.get("name", "unknown")
        label = norm_label(label)
        try:
            start = float(str(s.get("start", s.get("start_s", 0))).rstrip("s"))
        except:
            start = 0
        try:
            end = float(str(s.get("end", s.get("end_s", 0))).rstrip("s"))
        except:
            end = 0
        if end > start:
            out.append({"label": label, "start": round(start, 2), "end": round(end, 2)})
    return out


def clean_moments(moments):
    if not moments:
        return []
    seen = set()
    cleaned = []
    for m in sorted(moments, key=lambda x: float(str(x.get("time_s", 0)).rstrip("s"))):
        mtype = m.get("type") or m.get("is") or "unknown"
        try:
            t = float(str(m.get("time_s", 0)).rstrip("s"))
        except:
            t = 0
        key = f"{mtype}_{int(t / 3)}"
        if key in seen:
            continue
        seen.add(key)
        m["type"] = mtype
        m["time_s"] = round(t, 2)
        cleaned.append(m)
    return cleaned


def clean_emotion(emotion):
    if not emotion:
        return []
    out = []
    for e in emotion:
        try:
            item = {
                "start": float(str(e.get("start", e.get("start_s", 0))).rstrip("s")),
                "end": float(str(e.get("end", e.get("end_s", 0))).rstrip("s")),
                "energy": float(e.get("energy", 5)),
                "valence": float(e.get("valence", 5)),
                "arousal": float(e.get("arousal", 5)),
                "tension": float(e.get("tension", 5)),
                "brightness": float(e.get("brightness", 5)),
                "groove": float(e.get("groove", 5)),
                "emotion": str(e.get("emotion", "neutral")),
            }
            if "description" in e:
                item["description"] = str(e["description"])
            out.append(item)
        except:
            pass
    return out


def step_duration(wav):
    import librosa

    y, sr = librosa.load(wav, sr=None, mono=True)
    return round(len(y) / sr, 3)


def step_beats(wav):
    import numpy as np, madmom

    proc = madmom.features.RNNDownBeatProcessor()(wav)
    result = madmom.features.DBNDownBeatTrackingProcessor(
        beats_per_bar=[3, 4], fps=100
    )(proc)
    beats, downbeats = [], []
    for row in result:
        t, pos = float(row[0]), int(row[1])
        beats.append(round(t, 3))
        if pos == 1:
            downbeats.append(round(t, 3))
    intervals = np.diff(beats)
    intervals = intervals[(intervals > 0.2) & (intervals < 2.0)]
    bpm = round(60.0 / float(np.median(intervals)), 1) if len(intervals) > 0 else 120
    return beats, downbeats, bpm


def step_melody(wav):
    from basic_pitch.inference import predict

    _, _, note_events = predict(wav)
    notes = []
    for ev in note_events:
        notes.append(
            {
                "start": round(float(ev[0]), 3),
                "duration": round(float(ev[1]) - float(ev[0]), 3),
                "pitch": int(ev[2]),
                "velocity": round(float(ev[3]), 2),
            }
        )
    return sorted(notes, key=lambda n: n["start"])


def step_rhythm(wav):
    import librosa, numpy as np

    y, sr = librosa.load(wav, sr=22050, mono=True)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, onset_envelope=onset_env)
    onsets = librosa.frames_to_time(onset_frames, sr=sr)
    onset_strengths = onset_env[onset_frames] if len(onset_frames) > 0 else []
    peak = float(onset_env.max()) if len(onset_env) > 0 else 1.0
    hits = []
    for i, t in enumerate(onsets):
        strength = (
            float(onset_strengths[i]) / max(peak, 1e-6)
            if i < len(onset_strengths)
            else 0.5
        )
        hits.append(
            {"t": round(float(t), 3), "intensity": round(min(1.0, strength), 3)}
        )
    return {"hits": hits, "onset_count": len(hits)}


_bs_model = None


def step_53_stems(wav_path, slug):
    global _bs_model
    import numpy as np, torch, yaml, librosa
    from ml_collections import ConfigDict
    from models.bs_roformer import BSRoformer

    MODEL_PATH = os.path.join(BASE, "mega53", "model.ckpt")
    CONFIG_PATH = os.path.join(BASE, "mega53", "config.yaml")

    if _bs_model is None:
        with open(CONFIG_PATH) as f:
            config = ConfigDict(yaml.full_load(f))
        _bs_model = BSRoformer(**dict(config.model))
        state = torch.load(MODEL_PATH, map_location="cpu")
        _bs_model.load_state_dict(state)
        _bs_model.eval()
        _bs_model.cuda()
        print("    [53-stem model loaded]", flush=True)

    y, sr = librosa.load(wav_path, sr=44100, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])

    chunk_size = 352800
    n_samples = y.shape[-1]
    n_stems = len(ALL_STEMS)
    accum = np.zeros((n_stems, n_samples), dtype=np.float64)
    weight = np.zeros(n_samples, dtype=np.float32)
    overlap = int(chunk_size * 0.15)
    step = chunk_size - overlap

    for start in range(0, n_samples, step):
        end = min(start + chunk_size, n_samples)
        chunk = y[:, start:end]
        if chunk.shape[-1] < 4096:
            break
        with torch.no_grad():
            mix = torch.tensor(chunk, dtype=torch.float32).unsqueeze(0).cuda()
            out = _bs_model(mix)
            out_np = out[0].cpu().numpy()
            ns = min(out_np.shape[0], n_stems)
            for i in range(ns):
                mono = out_np[i].mean(axis=0) if out_np[i].ndim > 1 else out_np[i]
                accum[i, start : start + len(mono)] += mono[: end - start]
            weight[start:end] += 1.0
            del mix, out, out_np
        torch.cuda.empty_cache()

    weight = np.maximum(weight, 1.0)

    window_s = 0.5
    hop = int(window_s * sr)
    n_bins = max(1, n_samples // hop)

    summary = {}
    temporal = {}
    for i, name in enumerate(ALL_STEMS):
        stem = accum[i] / weight
        rms = float(np.sqrt(np.mean(stem**2)))
        if rms < 0.001:
            continue
        summary[name] = {
            "rms": round(rms, 6),
            "peak": round(float(np.max(np.abs(stem))), 4),
            "db": round(float(20 * np.log10(max(rms, 1e-10))), 1),
        }
        rms_vals = []
        for b in range(n_bins):
            c = stem[b * hop : (b + 1) * hop]
            rms_vals.append(
                round(float(np.sqrt(np.mean(c**2))), 5) if len(c) > 0 else 0
            )
        pk = max(rms_vals) if rms_vals else 1e-6
        if pk > 0:
            rms_vals = [round(v / pk, 3) for v in rms_vals]
        temporal[name] = rms_vals

    del accum, weight
    gc.collect()
    torch.cuda.empty_cache()

    return summary, {"window_s": window_s, "stems": temporal}


_btc_model = None


def step_chords(wav):
    global _btc_model
    if _btc_model is None:
        import torch
        from transformers import AutoModel

        os.environ.setdefault("HF_HOME", os.path.join(BASE, "hf"))
        _btc_model = AutoModel.from_pretrained(
            "puar-playground/btc-chord", trust_remote_code=True
        )
    chords = _btc_model.predict(wav)
    raw = [{"start": c["start"], "end": c["end"], "chord": c["chord"]} for c in chords]
    # Fill N-chords with previous real chord so there are no gaps
    prev = None
    for c in raw:
        if c["chord"] != "N":
            prev = c["chord"]
        elif prev:
            c["chord"] = prev
    # Remove any remaining leading N-chords
    return [c for c in raw if c["chord"] != "N"]


import requests

BAD = [
    "unable to analyze",
    "cannot provide",
    "no audio",
    "provide the audio",
    "general framework",
    "don't have access",
]


def moss_query(wav, prompt, max_tokens=16384):
    with sglang_lock:
        resp = requests.post(
            f"{SGLANG_URL}/generate",
            json={
                "text": prompt,
                "audio_data": wav,
                "sampling_params": {"max_new_tokens": max_tokens, "temperature": 0.05},
            },
            timeout=600,
        )
    resp.raise_for_status()
    text = resp.json()["text"]
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    if "<think>" in text:
        idx = text.find("[")
        text = text[idx:] if idx >= 0 else ""
    return text.strip()


def moss_json(wav, prompt, retries=3):
    for i in range(retries):
        try:
            raw = moss_query(wav, prompt)
            if any(b.lower() in raw.lower() for b in BAD):
                continue
            match = re.search(r"\[.*\]", raw, re.DOTALL)
            if match:
                return json.loads(match.group())
        except:
            pass
    return None


SECTIONS_PROMPT = (
    "Listen to this song and segment it into its structural sections with precise timestamps.\n\n"
    'Return ONLY a JSON array: [{"label": "...", "start": 0.0, "end": 15.5}, ...]\n\n'
    "Labels: intro, verse, pre-chorus, chorus, post-chorus, bridge, instrumental, solo, outro, "
    "breakdown, drop, build, interlude, hook, ad-lib, coda\n\n"
    "Repeated sections share the same label. Cover every second with no gaps. "
    "Prefer boundaries on strong beats. Output ONLY the JSON array."
)

MOMENTS_PROMPT = (
    "Listen to this song carefully and identify its significant musical moments - "
    "events a lighting designer, VJ, or video editor would sync visuals to.\n\n"
    "Return ONLY a JSON array:\n"
    '[{"time_s": float, "type": "...", "what": "specific instrument or element", '
    '"intensity": 0.0-1.0, "duration_s": float, '
    '"description": "unique sentence describing what makes this moment special"}, ...]\n\n'
    "Types: drop, build, breakdown, climax, entrance, exit, fill, accent, hook, release, "
    "pause, silence, vocal_moment, key_change, tempo_change, groove_lock, call_response, "
    "surprise, stab, swell, transition, solo\n\n"
    "Find moments across the ENTIRE song from start to finish. "
    "Include builds leading to drops, vocal entries, instrumental solos, "
    "texture changes, dynamic shifts, and transitions between sections. "
    "Name specific instruments and production elements. "
    "Every description must be unique and specific to THIS song. Output ONLY the JSON array."
)

EMOTION_PROMPT = (
    "Analyse the emotional trajectory of this song from beginning to end.\n\n"
    "Return ONLY a JSON array of segments, each covering approximately 10-15 seconds:\n"
    '[{"start": 0.0, "end": 15.0, "energy": 7, "valence": 6, "arousal": 8, '
    '"tension": 4, "brightness": 7, "groove": 8, '
    '"emotion": "euphoric", "description": "driving synths and soaring vocals create an uplifting rush"}, ...]\n\n'
    "Dimensions (all 1-10):\n"
    "- energy: loud/powerful vs quiet/soft\n"
    "- valence: happy/bright vs sad/dark\n"
    "- arousal: exciting/stimulating vs calm/relaxing\n"
    "- tension: tense/unresolved vs resolved/relaxed\n"
    "- brightness: bright/shimmering vs dark/heavy\n"
    "- groove: rhythmic/danceable vs still/ambient\n\n"
    "emotion: one word (euphoric, melancholic, aggressive, tender, triumphant, anxious, serene, "
    "nostalgic, defiant, playful, bittersweet, ethereal, intense, hopeful, dark, dreamy, powerful, etc.)\n\n"
    "description: one sentence about what creates that feeling - name instruments, textures, production.\n\n"
    "Cover the entire song with no gaps. Output ONLY the JSON array."
)

CAPTION_PROMPT = "Describe this song in one paragraph: genre, mood, instrumentation, production style, and overall vibe. Be specific and concise."
LYRICS_PROMPT = "Transcribe the lyrics of this song with timestamps. Format each line as:\n[MM:SS] lyric text\n\nIf there are no vocals or lyrics, respond with: [no lyrics]"
KEY_PROMPT = "What is the musical key and tempo of this song? Include mode (major/minor), any key changes, and time signature. Be concise."


def run_pipeline(wav_path):
    slug = os.path.splitext(os.path.basename(wav_path))[0]
    score = {"song": {"slug": slug}}
    t_total = time.time()

    t = time.time()
    dur = step_duration(wav_path)
    score["song"]["length_s"] = dur
    print(f"  duration: {dur:.1f}s ({time.time() - t:.1f}s)", flush=True)

    results = {}

    print("  [phase 1] beats | melody | rhythm (parallel CPU) ...", flush=True)
    p1 = time.time()
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            pool.submit(step_beats, wav_path): "beats",
            pool.submit(step_melody, wav_path): "melody",
            pool.submit(step_rhythm, wav_path): "rhythm",
        }
        for fut in as_completed(futures):
            name = futures[fut]
            try:
                results[name] = fut.result()
                if name == "beats":
                    b, d, bpm = results[name]
                    print(
                        f"    beats: {len(b)} beats, {bpm} bpm ({time.time() - p1:.1f}s)",
                        flush=True,
                    )
                elif name == "melody":
                    m = results[name]
                    print(
                        f"    melody: {len(m)} notes ({time.time() - p1:.1f}s)",
                        flush=True,
                    )
                elif name == "rhythm":
                    r = results[name]
                    print(
                        f"    rhythm: {r['onset_count']} onsets ({time.time() - p1:.1f}s)",
                        flush=True,
                    )
            except Exception as e:
                print(f"    {name}: FAILED {e}", flush=True)
                import traceback

                traceback.print_exc()
                results[name] = None
    print(f"  [phase 1] {time.time() - p1:.1f}s", flush=True)

    if results.get("beats"):
        import numpy as np

        beats, downbeats, bpm = results["beats"]
        score["beats"] = [{"t": b} for b in beats]
        bpb = 4
        if len(downbeats) >= 2:
            gaps = [
                downbeats[i + 1] - downbeats[i]
                for i in range(min(10, len(downbeats) - 1))
            ]
            if gaps:
                c = round((sum(gaps) / len(gaps)) / (60.0 / bpm))
                if c in (2, 3, 4, 6, 8):
                    bpb = c
        fb = beats[0] if beats else 0.0
        bd = (60.0 / bpm) * bpb
        score["grid"] = {
            "bpm": round(bpm, 3),
            "beats_per_bar": bpb,
            "first_beat_s": round(fb, 4),
            "bars": math.ceil((dur - fb) / bd) if bd > 0 else 0,
            "sure": True,
        }
    if results.get("melody"):
        score["melody"] = results["melody"]
    if results.get("rhythm"):
        score["rhythm"] = results["rhythm"]

    stop_sglang()

    print("  [phase 2] 53-stem separation + temporal (GPU) ...", flush=True)
    t = time.time()
    try:
        summary, temporal = step_53_stems(wav_path, slug)
        score["stems"] = summary
        score["stems_temporal"] = temporal
        print(
            f"    53-stems: {len(summary)} instruments, {len(temporal['stems'])} temporal ({time.time() - t:.1f}s)",
            flush=True,
        )
    except Exception as e:
        print(f"    53-stems: FAILED {e}", flush=True)
        import traceback

        traceback.print_exc()

    print("  [phase 2] chords (BTC GPU) ...", flush=True)
    t = time.time()
    try:
        chords = step_chords(wav_path)
        score["btc_chords_raw"] = chords
        print(f"    chords: {len(chords)} ({time.time() - t:.1f}s)", flush=True)
    except Exception as e:
        print(f"    chords: FAILED {e}", flush=True)

    global _btc_model
    if _btc_model is not None:
        del _btc_model
        _btc_model = None
        import torch

        torch.cuda.empty_cache()
        gc.collect()

    start_sglang()

    print("  [phase 3] MOSS queries ...", flush=True)
    p3 = time.time()
    for task, prompt, is_json in [
        ("sections", SECTIONS_PROMPT, True),
        ("moments", MOMENTS_PROMPT, True),
        ("emotion", EMOTION_PROMPT, True),
        ("caption", CAPTION_PROMPT, False),
        ("lyrics", LYRICS_PROMPT, False),
        ("key_tempo", KEY_PROMPT, False),
    ]:
        t = time.time()
        try:
            if is_json:
                raw = moss_json(wav_path, prompt)
                if raw:
                    if task == "sections":
                        score["sections"] = clean_sections(raw)
                    elif task == "moments":
                        score["moments"] = clean_moments(raw)
                    elif task == "emotion":
                        score["emotion"] = clean_emotion(raw)
                    print(
                        f"    {task}: {len(score.get(task, []))} ({time.time() - t:.1f}s)",
                        flush=True,
                    )
                else:
                    print(f"    {task}: empty ({time.time() - t:.1f}s)", flush=True)
            else:
                raw = moss_query(wav_path, prompt)
                cleaned = strip_think(raw)
                if task == "caption" and cleaned and len(cleaned) > 20:
                    score["caption"] = cleaned
                    print(
                        f"    caption: {len(cleaned)}c ({time.time() - t:.1f}s)",
                        flush=True,
                    )
                elif task == "lyrics":
                    if cleaned and "[no lyrics]" not in cleaned.lower():
                        lines = []
                        for line in cleaned.strip().split("\n"):
                            line = line.strip()
                            if not line:
                                continue
                            ts_match = re.match(
                                r"\[?(\d+:\d+(?:\.\d+)?)\]?\s*(.*)", line
                            )
                            if ts_match:
                                ts_str, text = ts_match.groups()
                                parts = ts_str.split(":")
                                secs = float(parts[0]) * 60 + float(parts[1])
                                text = re.sub(
                                    r"^-\s*\d+:\d+[\.\d]*\]\s*", "", text
                                ).strip()
                                text = re.sub(r"\[\d+:\d+[\.\d]*\]$", "", text).strip()
                                if text:
                                    lines.append(
                                        {"start": round(secs, 2), "text": text}
                                    )
                        if lines:
                            score["lyrics"] = {"lines": lines}
                    print(
                        f"    lyrics: {len(score.get('lyrics', {}).get('lines', []))} ({time.time() - t:.1f}s)",
                        flush=True,
                    )
                elif task == "key_tempo" and cleaned and len(cleaned) > 5:
                    score["key_tempo"] = cleaned
                    print(f"    key_tempo ({time.time() - t:.1f}s)", flush=True)
        except Exception as e:
            print(f"    {task}: FAILED {e}", flush=True)
    print(f"  [phase 3] {time.time() - p3:.1f}s", flush=True)

    for k in list(score.keys()):
        if score[k] is None or score[k] == {} or score[k] == []:
            del score[k]

    out = os.path.join(SCORE_OUT, f"{slug}.score")
    with open(out, "w") as f:
        json.dump(score, f, indent=2, ensure_ascii=False)

    elapsed = time.time() - t_total
    ns = len(score.get("sections", []))
    nm = len(score.get("moments", []))
    nn = len(score.get("melody", []))
    nr = len(score.get("rhythm", {}).get("hits", []))
    nts = len(score.get("stems_temporal", {}).get("stems", {}))
    ne = len(score.get("emotion", []))
    print(
        f"  === {slug}: {ns}sec {nm}mom {nn}mel {nr}rhy {nts}stems {ne}emo | {elapsed:.0f}s",
        flush=True,
    )
    return score


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "wav")
    if os.path.isdir(target):
        wavs = sorted(glob.glob(os.path.join(target, "*.wav")))
    else:
        wavs = [target]

    print(f"Limelight Pipeline: {len(wavs)} songs", flush=True)
    for i, wav in enumerate(wavs):
        print(f"\n[{i + 1}/{len(wavs)}] {os.path.basename(wav)}", flush=True)
        try:
            run_pipeline(wav)
        except Exception as e:
            print(f"  PIPELINE FAILED: {e}", flush=True)
            import traceback

            traceback.print_exc()

    print(f"\nALL DONE: {len(wavs)} scores in {SCORE_OUT}", flush=True)
