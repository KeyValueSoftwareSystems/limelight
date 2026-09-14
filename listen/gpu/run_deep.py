import os, json, time, glob, re
import requests

SGLANG_URL = os.environ.get("SGLANG_URL", "http://localhost:30000")
OUT_DIR = os.environ.get("OUT_DIR", "moss-v2")
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
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def query(wav_path, prompt, max_tokens=8192):
    resp = requests.post(
        f"{SGLANG_URL}/generate",
        json={
            "text": prompt,
            "audio_data": wav_path,
            "sampling_params": {"max_new_tokens": max_tokens, "temperature": 0.0},
        },
        timeout=600,
    )
    resp.raise_for_status()
    return strip_think(resp.json()["text"])


MOMENTS_PROMPT = """Identify every notable musical moment/event in this song. A "moment" is a specific event at a precise time that a lighting desk, rhythm game, or video editor would fire a cue on.

Return ONLY a JSON array. Each object must have:
- "time_s": float (seconds from start)
- "type": one of the types below
- "what": string (specific instrument or element involved)
- "intensity": float 0.0–1.0 (how impactful)
- "duration_s": float (0 for punctual, >0 for spans like builds/fills)
- "description": string (one sentence)

MOMENT TYPES (use the most specific one):
- drop: the exact moment bass/kick returns after a build — maximum energy payoff
- build: rising tension (snare roll, filter sweep, noise riser) leading to a drop or chorus
- breakdown: energy deliberately stripped — pads only, half the instruments gone
- climax: peak emotional/dynamic intensity of the entire song
- entrance: a specific instrument enters (name it: "kick", "lead vocal", "strings", etc.)
- exit: a specific instrument drops out
- fill: drum fill or percussive flourish
- accent: sharp full-band hit, stab, or rhythmic unison
- hook: the main melodic hook or riff appears/returns
- release: tension resolves — the payoff after sustained tension
- pause: brief silence or near-silence (everything drops momentarily)
- silence: true silence, longer than a beat
- vocal_moment: belting, falsetto switch, ad-lib, vocal run, scream, whisper
- key_change: modulation to a different key
- tempo_change: BPM shifts
- groove_lock: rhythm locks into a tight new pocket/groove
- call_response: musical or vocal call-and-response
- surprise: unexpected harmonic, rhythmic, or textural shift
- stab: short sharp rhythmic unison hit
- swell: gradual crescendo (strings, pads, choir building)
- transition: passage connecting two sections (not a section itself)
- solo: single instrument spotlight begins

RULES:
1. Find AT LEAST 15 moments, ideally 20-40 for a full song.
2. Every drop, build, and breakdown MUST be identified — these are the most important.
3. Name specific instruments from the 53-stem vocabulary (kick, snare, lead-vocal, synth, strings, etc.), not generic "drums" or "other".
4. The "climax" type should appear exactly once — the single most intense moment.
5. Cover the entire song — don't cluster all moments in the first half.
6. Output ONLY the JSON array, no explanation."""

SECTIONS_V2_PROMPT = """Segment this song into structural sections with precise timestamps.

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

EMOTION_PROMPT = """Analyze the emotional trajectory of this song from start to finish.

Return ONLY a JSON array of segments, each covering ~10-15 seconds:
[{
  "start": 0.0, "end": 15.0,
  "energy": 7, "valence": 6, "arousal": 8,
  "emotion": "euphoric",
  "description": "High energy synth build with rising anticipation"
}, ...]

- energy: 1-10 (how loud/intense)
- valence: 1-10 (how positive/happy vs sad/dark)
- arousal: 1-10 (how exciting/stimulating vs calm)
- emotion: one word (euphoric, melancholic, aggressive, tender, triumphant, anxious, serene, nostalgic, defiant, playful, etc.)
- description: one sentence about what's happening musically

Cover the ENTIRE song. Identify the emotional climax."""

PROMPTS = {
    "sections": SECTIONS_V2_PROMPT,
    "moments": MOMENTS_PROMPT,
    "emotion": EMOTION_PROMPT,
}

if __name__ == "__main__":
    wavs = sorted(glob.glob(os.path.join(WAV_DIR, "*.wav")))
    print(f"MOSS v2: {len(wavs)} songs x {len(PROMPTS)} prompts", flush=True)

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
                    # Try to parse JSON
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

        results["_model"] = "MOSS-Music-8B-Thinking"
        results["_engine"] = "sglang-generate"
        results["_time_s"] = round(time.time() - t0, 1)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"  DONE {slug} in {results['_time_s']:.0f}s", flush=True)

    print("MOSS_V2_DONE", flush=True)
