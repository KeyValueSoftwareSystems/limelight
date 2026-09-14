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
            "sampling_params": {"max_new_tokens": max_tokens, "temperature": 0.05},
        },
        timeout=600,
    )
    resp.raise_for_status()
    return strip_think(resp.json()["text"])


SECTIONS_PROMPT = """Listen to this song and segment it into its structural sections with precise timestamps.

Return ONLY a JSON array: [{"label": "...", "start": 0.0, "end": 15.5}, ...]

Labels: intro, verse, pre-chorus, chorus, post-chorus, bridge, instrumental, solo, outro, breakdown, drop, build, interlude, hook, ad-lib, coda

Repeated sections share the same label. Cover every second with no gaps. Prefer boundaries on strong beats. Output ONLY the JSON array."""

MOMENTS_PROMPT = """Listen to this song and identify its most significant musical moments — events a lighting designer or video editor would cue on.

Return ONLY a JSON array:
[{"time_s": float, "type": "...", "what": "specific instrument", "intensity": 0.0-1.0, "duration_s": float, "description": "unique sentence"}, ...]

Types: drop, build, breakdown, climax, entrance, exit, fill, accent, hook, release, pause, silence, vocal_moment, key_change, tempo_change, groove_lock, call_response, surprise, stab, swell, transition, solo

Focus on quality — only genuinely noticeable events. Name specific instruments. Every description must be unique. Output ONLY the JSON array."""

EMOTION_PROMPT = """Analyse the emotional trajectory of this song from beginning to end.

Return ONLY a JSON array of segments, each covering approximately 10-15 seconds:
[{"start": 0.0, "end": 15.0, "energy": 7, "valence": 6, "arousal": 8, "tension": 4, "brightness": 7, "groove": 8, "emotion": "euphoric", "description": "driving synths and soaring vocals create an uplifting rush"}, ...]

Dimensions (all 1-10):
- energy: loud/powerful vs quiet/soft
- valence: happy/bright vs sad/dark
- arousal: exciting/stimulating vs calm/relaxing
- tension: tense/unresolved vs resolved/relaxed
- brightness: bright/shimmering vs dark/heavy
- groove: rhythmic/danceable vs still/ambient

emotion: one word (euphoric, melancholic, aggressive, tender, triumphant, anxious, serene, nostalgic, defiant, playful, bittersweet, ethereal, intense, hopeful, dark, dreamy, powerful, etc.)
description: one sentence about what creates that feeling - name instruments, textures, production.

Cover the entire song with no gaps. Output ONLY the JSON array."""

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
        results = {}

        t0 = time.time()
        print(f"[{i + 1}/{len(wavs)}] {slug}", flush=True)

        for task, prompt in PROMPTS.items():
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
