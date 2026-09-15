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
    os.system('pkill -9 -f "sglang" 2>/dev/null')
    import time as _t

    _t.sleep(2)
    os.system('pkill -9 -f "sglang" 2>/dev/null')
    _t.sleep(2)
    os.system("fuser -k /dev/nvidia* 2>/dev/null")
    _t.sleep(2)
    import torch

    torch.cuda.empty_cache()
    gc.collect()
    free = torch.cuda.mem_get_info()[0] / 1e9
    print(f"    [GPU free: {free:.1f} GB]", flush=True)


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


def clean_moments(moments, beats=None, section_bounds=None):
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
        if section_bounds:
            closest_sec = min(section_bounds, key=lambda b: abs(b - t))
            if abs(closest_sec - t) < 3.0:
                t = closest_sec
        if beats:
            closest = min(beats, key=lambda b: abs(b - t))
            if abs(closest - t) < 1.0:
                t = closest
        key = f"{mtype}_{int(t / 3)}"
        if key in seen:
            continue
        seen.add(key)
        m["type"] = mtype
        m["time_s"] = round(t, 3)
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


def moss_query(wav, prompt, max_tokens=8192):
    with sglang_lock:
        resp = requests.post(
            f"{SGLANG_URL}/generate",
            json={
                "text": prompt,
                "audio_data": wav,
                "sampling_params": {"max_new_tokens": max_tokens, "temperature": 0.05},
            },
            timeout=300,
        )
    resp.raise_for_status()
    text = resp.json()["text"]
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    if "<think>" in text:
        idx = text.find("[")
        if idx >= 0:
            text = text[idx:]
        else:
            idx = text.find("{")
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


COMMON_PROMPT = (
    "Analyze only the supplied audio. Ground every annotation in audible evidence. "
    "Describe the music itself, without prescribing lighting, visuals or other actions. "
    "Do not infer events from genre conventions or an expected song structure.\n\n"
    "All timestamps are seconds relative to the beginning of the supplied audio. "
    "Use your best supported timing estimate; extra decimal places do not imply accuracy. "
    "Use the supplied duration as the authoritative endpoint.\n\n"
    "Return valid JSON only: no Markdown, commentary, NaN or trailing commas. "
    "Use exactly the requested fields."
)

SECTIONS_PROMPT = (
    "Listen to the entire recording and identify its major structural sections. "
    "Assess repetition, contrast, melody, harmony, rhythm, vocals and arrangement "
    "together. Loudness changes alone do not establish a new section.\n\n"
    "Return a JSON array of objects with exactly these fields:\n"
    "- label: one allowed section label\n"
    "- start: number, seconds\n"
    "- end: number, seconds\n\n"
    "Allowed labels:\n"
    "- intro: opening passage establishing the piece before its main body\n"
    "- verse: recurring passage developing lyrical or musical material, often with changing words over related music\n"
    "- pre-chorus: distinct passage preparing a chorus\n"
    "- chorus: recurring central refrain or thematic anchor; it need not be the loudest passage, and a catchy motif alone does not establish a chorus\n"
    "- post-chorus: distinct extension or response following a chorus\n"
    "- bridge: contrasting passage providing departure from the surrounding structure; it may occur more than once\n"
    "- instrumental: distinct instrument-led passage whose structural role is not better described by another allowed label\n"
    "- solo: distinct passage organized around a foregrounded instrumental lead\n"
    "- breakdown: sustained reduction or dismantling of an established arrangement\n"
    "- drop: sustained payoff section marked by the arrival or return of a prominent beat, bass or main groove; label the passage, not just its first hit\n"
    "- build: distinct passage organized around increasing anticipation or intensity\n"
    "- interlude: intervening passage connecting or separating larger sections\n"
    "- outro: closing passage, whether fading, sustained or forceful\n"
    "- other: clear structural passage that does not fit the allowed labels\n\n"
    "Rules:\n"
    "- Cover 0.0 through the supplied duration with no gaps or overlaps.\n"
    "- Every section must have start < end.\n"
    "- Sort by start; each end must equal the next start.\n"
    "- The final end must equal the supplied duration exactly.\n"
    "- Place boundaries at audible structural transitions. Use beat or phrase alignment when supported; do not force off-beat or free-time changes onto a grid.\n"
    "- Preserve recurring section boundaries even when adjacent labels are identical.\n"
    "- Repeated sections use the same label, without numbering.\n"
    "- Do not split for a brief fill, accent, entrance or small arrangement variation.\n"
    "- Do not label every vocal-free passage instrumental: an instrumental intro, chorus or outro should retain its structural role.\n"
    "- Do not require an intro, chorus, bridge, outro or any fixed section count.\n"
    "- Use other when a role is unclear or outside this vocabulary; do not force verse-chorus form onto the recording.\n\n"
    "Return ONLY the JSON array."
)

MOMENTS_PROMPT = (
    "Listen across the entire recording and identify salient, localized musical "
    "events: occurrences that a reader could meaningfully reference or synchronize to. "
    "Select clearly audible events, not every note, beat or minor fluctuation.\n\n"
    "Return a JSON array of objects with exactly these fields:\n"
    "- time_s: number, event anchor in seconds (use precise fractional values like 13.4, not rounded)\n"
    "- type: one allowed event type (see below)\n"
    "- what: affected instrument, voice, layer or ensemble\n"
    "- intensity: number from 0.0 to 1.0, perceived prominence of this event in its local musical context; this is not confidence or absolute loudness\n"
    "- description: short, factual description of what audibly happens\n\n"
    "Allowed types and timestamp anchors:\n"
    "- entrance: a voice, instrument or layer joins or returns after a MEANINGFUL absence (not a brief pause within a phrase); timestamp its audible onset\n"
    "- exit: a voice, instrument or layer leaves for a meaningful interval; timestamp its audible departure, excluding lingering reverb\n"
    "- accent: a hit, note or chord that stands out from the surrounding pattern — crashes, sforzando, unexpected chord, stab; timestamp its onset\n"
    "- fill: a brief rhythmic or melodic embellishment between phrases — drum fill, guitar lick, synth run; timestamp its beginning\n"
    "- stop: an abrupt ensemble-wide interruption where most/all layers cut out; timestamp the cutoff\n"
    "- resume: ensemble activity restarts after an interruption; timestamp the restart\n"
    "- change: a distinct switch in groove, harmony, timbre or texture — e.g. half-time feel begins, filter sweep opens, key modulation; timestamp the switch. Exclude routine chord changes\n"
    "- arrival: a clearly marked landing of a section or major phrase/theme — the drop lands, the chorus kicks in; timestamp the landing, not its preceding preparation\n"
    "- hook_onset: the beginning of a clearly recognizable hook/riff occurrence; mark each recurrence\n"
    "- climax: a salient local culmination of intensity or expression — the loudest point, peak of a build; timestamp the culmination, not the start of its buildup\n"
    "- resolution: a clearly audible settling of musical tension — tension dissolves, energy drops to rest; timestamp the settling point\n\n"
    "TYPE DIVERSITY IS CRITICAL:\n"
    "- You MUST use a variety of types. If your output has more than 40% of any single type, you are doing it wrong.\n"
    "- A typical recording has: entrances AND exits (instruments come and go), accents (crashes, stabs), "
    "changes (texture/groove shifts), fills (drum fills, melodic ornaments), arrivals (section landings), "
    "and at least one climax and resolution.\n"
    "- Do NOT label a texture change, groove shift, or section landing as 'entrance'. "
    "Use 'change' for texture/groove shifts, 'arrival' for section landings, 'accent' for prominent hits.\n"
    "- 'entrance' is ONLY for when a previously absent instrument/voice literally starts playing.\n"
    "- A vocal continuing to sing after a brief instrumental break is NOT an entrance — it is a 'resume' or just part of the flow.\n\n"
    "Rules:\n"
    "- Sort chronologically; all times must be >= 0 and < the supplied duration.\n"
    "- Do not annotate every kick, snare, chord change, phrase or vocal breath.\n"
    "- Do not enumerate all instruments already present at the recording's start.\n"
    "- Repeated salient hook occurrences or fills may each receive an event.\n"
    "- Use entrance/exit for individual layers and stop/resume for the ensemble.\n"
    "- Prefer a specific type over 'change' when a specific type fits.\n"
    "- Simultaneous events are allowed when they convey distinct information; do not describe the same event redundantly under several types.\n"
    "- Name instruments only as specifically as the audio supports.\n"
    "- Intensity anchors: 0.25 noticeable but subtle; 0.5 clear; 0.75 prominent; 1.0 exceptionally dominant locally.\n"
    "- A quiet stop or exposed entrance can be highly prominent.\n"
    "- Omit speculative events. Return [] if none are clearly supported.\n\n"
    "Return ONLY the JSON array."
)

EMOTION_PROMPT = (
    "Listen to the entire recording and describe its perceived expressive character "
    "over time. Treat emotion as an interpretation supported by audible musical cues, "
    "not an objective fact about what every listener feels.\n\n"
    "Return a JSON array of objects with exactly these fields:\n"
    "- start: number, seconds\n"
    "- end: number, seconds\n"
    "- energy: integer from 1 to 10\n"
    "- valence: integer from 1 to 10\n"
    "- arousal: integer from 1 to 10\n"
    "- tension: integer from 1 to 10\n"
    "- brightness: integer from 1 to 10\n"
    "- groove: integer from 1 to 10\n"
    "- emotion: one allowed label\n"
    "- description: short explanation connecting audible sounds to the interpretation\n\n"
    "Rate dimensions independently using these anchors:\n"
    "- energy: 1 = very restrained or delicate; 5 = moderate force; 10 = exceptionally forceful or powerful\n"
    "- valence: 1 = strongly sorrowful or negative; 5 = neutral or mixed; 10 = strongly joyful or positive\n"
    "- arousal: 1 = deeply calm; 5 = moderately activated; 10 = intensely excited or agitated\n"
    "- tension: 1 = settled or at rest; 5 = some anticipation or instability; 10 = strongly unresolved or suspenseful\n"
    "- brightness: 1 = dark or muted timbre; 5 = balanced; 10 = brilliant or sharp timbre; this is a timbral property, not happiness\n"
    "- groove: 1 = little perceived rhythmic pull; 5 = moderate rhythmic pull; 10 = compelling rhythmic propulsion; this is not simply tempo or loudness\n\n"
    "Allowed emotion labels:\n"
    "anticipation, euphoria, melancholy, aggression, tenderness, triumph, "
    "anxiety, serenity, nostalgia, defiance, playfulness, bittersweetness, "
    "wonder, intensity, hope, darkness, dreaminess, power, longing, joy, "
    "tension, release, grandeur, intimacy, rebellion, bliss, unease, "
    "confidence, vulnerability, freedom, neutral, mixed\n\n"
    "Rules:\n"
    "- Cover 0.0 through the supplied duration with no gaps or overlaps.\n"
    "- Every segment must have start < end.\n"
    "- Sort by start; each end must equal the next start.\n"
    "- The final end must equal the supplied duration exactly.\n"
    "- Split at meaningful, sustained changes in expressive character or dimensions.\n"
    "- Do not split at fixed intervals, every musical event or every section boundary.\n"
    "- Stable passages should retain stable values and may retain the same emotion.\n"
    "- Do not invent an emotional journey or force use of the full rating range.\n"
    "- A quiet intro and a loud drop may share an emotion while differing in energy.\n"
    "- High energy does not imply positive valence; low energy does not imply sadness.\n"
    "- Groove can be strong in quiet music; tension can rise while energy falls.\n"
    "- Choose mixed for clearly coexisting emotional qualities and neutral when no strong emotional character is supported.\n"
    "- Describe audible causes: phrasing, harmony, rhythm, register, instrumentation, texture or dynamics. Do not invent lyrics, narrative or performer intentions.\n\n"
    "Return ONLY the JSON array."
)

CAPTION_PROMPT = (
    "Describe the entire recording in one concise paragraph of approximately 80-120 words.\n\n"
    "Include, where clearly audible:\n"
    "- Main style or genre, using a broader description if the subgenre is uncertain.\n"
    "- Overall mood and how it develops.\n"
    "- Prominent instruments, vocal delivery and their musical roles.\n"
    "- Rhythm and feel.\n"
    "- Audible production characteristics, such as space, layering, distortion, reverb and the balance between acoustic and electronic sounds.\n"
    "- The most distinctive musical feature or structural contrast.\n\n"
    "Prioritize characteristics that distinguish this recording. "
    "Name instruments only as specifically as the audio supports. "
    "Describe audible production qualities without inventing equipment, recording location, artist identity, release era or production methods. "
    "Do not invent lyrics or a narrative, and avoid generic praise. "
    "A stable recording does not require a changing mood or dramatic contrast.\n\n"
    "Return ONLY the paragraph, overriding the common JSON-output instruction."
)

LYRICS_PROMPT = (
    "Transcribe the intelligible sung, rapped or spoken words throughout the recording in their original language and script. Do not translate or paraphrase.\n\n"
    "Format each lyric line as:\n[MM:SS.s] lyric text\n\n"
    "Rules:\n"
    "- Timestamp the audible beginning of each line relative to the supplied audio.\n"
    "- Split into natural lyrical phrases, not individual words or entire verses.\n"
    "- Include every audible repetition; do not write 'chorus repeats'.\n"
    "- Preserve audible wording, including explicit language.\n"
    "- Do not reconstruct words from familiarity with a song or expected rhymes.\n"
    "- Mark an unrecoverable word or span as [inaudible] within the line.\n"
    "- If an entire attempted lyrical phrase is unintelligible, output a timestamped [inaudible] line rather than inventing words.\n"
    "- Include clearly intelligible backing-vocal words and ad-libs.\n"
    "- Omit instrumental passages, breaths and purely wordless vocalizations.\n"
    "- Do not add verse/chorus headings, commentary or an invented speaker identity.\n"
    "- Order lines by onset. Timestamps are estimates, not guaranteed alignment.\n\n"
    "If there are no lyrical or spoken words, including recordings with only wordless vocals, return exactly:\n"
    "[no lyrics]\n\n"
    "Return ONLY the timestamped transcription or [no lyrics], overriding the common JSON-output instruction."
)

KEY_PROMPT = (
    "Analyze the tonal center, tempo and meter across the entire recording.\n\n"
    "Return concise text using exactly these headings:\nKey:\nTempo:\nTime signature:\nChanges:\n\n"
    "Key:\n"
    "- Give the best-supported tonic and mode.\n"
    "- Do not force major/minor when a modal, ambiguous or non-tonal description fits.\n"
    "- Distinguish the overall tonal center from individual chords.\n"
    "- If genuinely ambiguous, state the main plausible alternatives.\n\n"
    "Tempo:\n"
    "- Give the best-supported main pulse in BPM.\n"
    "- Mention a half-time or double-time alternative only when genuinely plausible.\n"
    "- Describe variable tempo, rubato or free time when a single BPM is misleading.\n\n"
    "Time signature:\n"
    "- Give the best-supported meter.\n"
    "- State uncertainty or free meter rather than forcing 4/4.\n\n"
    "Changes:\n"
    "- List clearly supported changes in tonal center, tempo or meter with approximate onset timestamps in [MM:SS.s] format.\n"
    "- Do not mistake routine chord changes for modulation, or a change in rhythmic density for a tempo change.\n"
    "- If no clear changes are detected, write 'No clear changes detected.'\n\n"
    "Return ONLY these four fields as text, overriding the common JSON-output instruction."
)


def make_prompt(task_prompt, duration_s):
    return f"{COMMON_PROMPT}\n\nAuthoritative audio duration: {duration_s} seconds.\n\n{task_prompt}"


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
    dur = score["song"]["length_s"]
    for task, raw_prompt, is_json in [
        ("sections", SECTIONS_PROMPT, True),
        ("moments", MOMENTS_PROMPT, True),
        ("emotion", EMOTION_PROMPT, True),
        ("caption", CAPTION_PROMPT, False),
        ("lyrics", LYRICS_PROMPT, False),
        ("key_tempo", KEY_PROMPT, False),
    ]:
        prompt = make_prompt(raw_prompt, dur)
        t = time.time()
        try:
            if is_json:
                raw = moss_json(wav_path, prompt)
                if raw:
                    if task == "sections":
                        cleaned = clean_sections(raw)
                        dur = score["song"]["length_s"]
                        coverage = (
                            max((s["end"] for s in cleaned), default=0)
                            if cleaned
                            else 0
                        )
                        if coverage < dur * 0.8:
                            print(
                                f"    sections: only covers {coverage:.0f}/{dur:.0f}s, retrying...",
                                flush=True,
                            )
                            raw2 = moss_json(wav_path, prompt)
                            if raw2:
                                c2 = clean_sections(raw2)
                                cov2 = (
                                    max((s["end"] for s in c2), default=0) if c2 else 0
                                )
                                if cov2 > coverage:
                                    cleaned = c2
                        score["sections"] = cleaned
                    elif task == "moments":
                        beat_times = [b["t"] for b in score.get("beats", [])]
                        sec_bounds = []
                        for s in score.get("sections", []):
                            sec_bounds.extend([s["start"], s["end"]])
                        score["moments"] = clean_moments(
                            raw,
                            beats=beat_times,
                            section_bounds=sorted(set(sec_bounds)),
                        )
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
