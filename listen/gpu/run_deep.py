import os, json, time, glob, re
import requests

SGLANG_URL = os.environ.get("SGLANG_URL", "http://localhost:30000")
OUT_DIR = os.environ.get("OUT_DIR", "deep")
WAV_DIR = os.environ.get("WAV_DIR", "wav")
os.makedirs(OUT_DIR, exist_ok=True)

BAD = [
    "unable to analyze",
    "cannot provide",
    "no audio",
    "haven't provided",
    "no song has been",
    "provide the audio",
    "What I can do",
    "general framework",
    "provide me with",
    "don't have access",
    "I don't have enough information",
]


def is_bad(text):
    return any(b.lower() in text.lower() for b in BAD)


def strip_think(text):
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    if "<think>" in text:
        idx = text.find("[")
        if idx >= 0:
            text = text[idx:]
        else:
            text = ""
    return text.strip()


def query(wav_path, prompt, max_tokens=16384):
    resp = requests.post(
        f"{SGLANG_URL}/generate",
        json={
            "text": prompt,
            "audio_data": wav_path,
            "sampling_params": {"max_new_tokens": max_tokens, "temperature": 0.1},
        },
        timeout=600,
    )
    resp.raise_for_status()
    return strip_think(resp.json()["text"])


SECTIONS_PROMPT = """Segment this song into structural sections with precise timestamps.

Return ONLY a JSON array: [{"label": "...", "start": 0.0, "end": 15.5}, ...]

LABEL VOCABULARY — pick the MOST SPECIFIC label:

UNIVERSAL:
intro, verse, pre-chorus, chorus, post-chorus, bridge, instrumental, solo, interlude, outro, coda, breakdown, ad-lib

EDM/ELECTRONIC:
drop (bass+kick return after build, maximum energy), build (rising tension: snare rolls, filter sweep, riser), breakdown (energy removed, atmospheric)

ROCK/METAL:
riff (guitar-driven melodic pattern), solo, breakdown (heavy half-tempo)

HIP-HOP:
hook, verse, skit

INDIAN CLASSICAL (Carnatic): pallavi, anupallavi, charanam, chittaswaram
INDIAN CLASSICAL (Hindustani): sthayi, antara, sanchari, abhog
R&B/SOUL: vamp, tag

CRITICAL RULES:
1. Do NOT use generic labels when a specific one fits. If bass drops in after a build → "drop" not "chorus". If guitar plays alone → "solo" not "instrumental".
2. Do NOT number sections (no "verse 1"). Timestamps differentiate repeats.
3. Every second must be covered — no gaps.
4. For Indian classical/semi-classical, use Indian terminology.
5. For EDM: builds MUST be labeled "build", drops MUST be labeled "drop", breakdowns MUST be "breakdown".
6. Output ONLY the JSON array."""

MOMENTS_PROMPT = """Identify the most important structural moments in this song. A "moment" is a significant musical event that a lighting designer, rhythm game, or video editor would cue on.

Return ONLY a JSON array. Each object:
- "time_s": float (seconds from start)
- "type": one of the types below
- "what": string (specific instrument involved)
- "intensity": float 0.0–1.0
- "duration_s": float (0 for instant, >0 for spans)
- "description": string (one UNIQUE sentence — never repeat the same description)

MOMENT TYPES:
drop, build, breakdown, climax, entrance, exit, fill, accent, hook, release, pause, silence, vocal_moment, key_change, tempo_change, groove_lock, call_response, surprise, stab, swell, transition, solo

RULES:
1. Only genuinely significant events — NOT every beat or instrument hit.
2. A typical 3-minute song has 10-20 moments. A 6-minute song has 15-30.
3. Each "drop" means the ACTUAL bass return after a build. A song has 1-4 drops max.
4. Each "build" means sustained rising tension. A song has 1-4 builds max.
5. "climax" appears EXACTLY ONCE — the single peak of the entire song.
6. Every description must be UNIQUE. Never write "continues" or "again".
7. Name specific instruments (kick, snare, lead vocal, synth pad, bass guitar), not "drums" or "instruments".
8. Cover the whole song evenly — don't cluster in the first half.
9. Output ONLY the JSON array."""

EMOTION_PROMPT = """Analyze the emotional trajectory of this song from start to finish.

Return ONLY a JSON array of segments, each covering ~10-15 seconds:
[{"start": 0.0, "end": 15.0, "energy": 7, "valence": 6, "arousal": 8, "emotion": "euphoric", "description": "..."}, ...]

- energy: 1-10 (loud/intense vs quiet)
- valence: 1-10 (positive/happy vs sad/dark)
- arousal: 1-10 (exciting vs calm)
- emotion: one word (euphoric, melancholic, aggressive, tender, triumphant, anxious, serene, nostalgic, defiant, playful, etc.)
- description: one sentence about what's happening musically

Cover the ENTIRE song. Identify the emotional climax."""

PROMPTS = {
    "sections": SECTIONS_PROMPT,
    "moments": MOMENTS_PROMPT,
    "emotion": EMOTION_PROMPT,
}

if __name__ == "__main__":
    wavs = sorted(glob.glob(os.path.join(WAV_DIR, "*.wav")))
    print(f"MOSS deep: {len(wavs)} songs x {len(PROMPTS)} prompts", flush=True)

    for i, wav in enumerate(wavs):
        slug = os.path.splitext(os.path.basename(wav))[0]
        out_path = os.path.join(OUT_DIR, f"{slug}.json")
        if os.path.exists(out_path):
            existing = json.load(open(out_path))
            if all(k in existing for k in PROMPTS):
                print(f"[{i + 1}/{len(wavs)}] {slug} — skip (complete)", flush=True)
                continue

        t0 = time.time()
        print(f"[{i + 1}/{len(wavs)}] {slug}", flush=True)
        results = {}
        if os.path.exists(out_path):
            results = json.load(open(out_path))

        for task, prompt in PROMPTS.items():
            if task in results:
                print(f"  {task}: cached", flush=True)
                continue
            tt = time.time()
            for attempt in range(3):
                try:
                    resp = query(wav, prompt)
                    if is_bad(resp):
                        print(f"  {task}: BAD attempt {attempt + 1}", flush=True)
                        continue
                    match = re.search(r"\[.*\]", resp, re.DOTALL)
                    if match:
                        parsed = json.loads(match.group())
                        results[task] = parsed
                        print(
                            f"  {task}: {len(parsed)} items, {time.time() - tt:.1f}s",
                            flush=True,
                        )
                    else:
                        results[task + "_raw"] = resp
                        print(
                            f"  {task}: no JSON found, saved raw ({len(resp)}c), {time.time() - tt:.1f}s",
                            flush=True,
                        )
                    break
                except json.JSONDecodeError as e:
                    print(
                        f"  {task}: JSON parse error attempt {attempt + 1}: {e}",
                        flush=True,
                    )
                except Exception as e:
                    print(f"  {task}: ERR attempt {attempt + 1}: {e}", flush=True)

        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"  DONE {slug} in {time.time() - t0:.0f}s", flush=True)

    print("DONE_ALL", flush=True)
