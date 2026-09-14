import os, json, time, glob
import requests

SGLANG_URL = os.environ.get("SGLANG_URL", "http://localhost:30000")
OUT_DIR = os.environ.get("OUT_DIR", "work/moss-full")
WAV_DIR = os.environ.get("WAV_DIR", "work/wav")
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


def query(wav_path, prompt, max_tokens=4096):
    resp = requests.post(
        f"{SGLANG_URL}/generate",
        json={
            "text": prompt,
            "audio_data": wav_path,
            "sampling_params": {"max_new_tokens": max_tokens, "temperature": 0.0},
        },
        timeout=300,
    )
    resp.raise_for_status()
    return resp.json()["text"]


SECTIONS_PROMPT = """Segment this song into structural sections with precise timestamps.

Use ONLY these standard musicological labels (pick the most accurate one for each section):

UNIVERSAL (all genres):
- intro: opening, sets mood/groove before main material
- verse: storytelling section, lyrics change each time
- pre-chorus (also: lift, climb, build-up): tension builder before chorus
- chorus (also: hook, refrain): main emotional payoff, repeated lyrics
- post-chorus: extends the high after chorus, second hook
- bridge (also: middle-eight, release): contrasting section, new material, usually once
- instrumental: passage with no vocals, featuring instruments
- solo: single instrument spotlight (guitar solo, sax solo, etc.)
- interlude: short transitional passage between major sections
- outro: ending section, wind-down or fade
- coda: distinct ending passage after the main structure concludes
- breakdown: energy stripped back, usually just pads/vocals, no drums
- ad-lib: vocal improvisation section, often at end

EDM / ELECTRONIC / DANCE:
- drop: the payoff — bass and kick return after build, maximum energy
- build (also: riser): rising energy with snare rolls, rising pitch, building to drop
- breakdown: energy removed, atmospheric, before the build

ROCK / METAL:
- riff: instrumental melodic pattern, usually guitar-driven
- solo: single instrument improvisation
- breakdown: heavy, rhythmic section, often half-tempo

HIP-HOP / RAP:
- hook: repeated catchy phrase (may or may not be sung)
- verse: 16-bar rap section
- skit: spoken word / dialogue interlude

INDIAN CLASSICAL (Carnatic):
- pallavi: refrain/theme, main melodic idea
- anupallavi: secondary theme, higher register development
- charanam: concluding stanza(s)
- chittaswaram: instrumental note passage (no lyrics)

INDIAN CLASSICAL (Hindustani):
- sthayi: main theme in middle register
- antara: second section, upper register
- sanchari: development section
- abhog: concluding section

R&B / SOUL:
- vamp: repeated groove, often extended
- tag: repeated ending phrase

RULES:
1. Do NOT number sections (no "verse 1", "chorus 2"). Just use the label.
2. If the same section type repeats, still use the same label — the timestamps differentiate them.
3. Pick the MOST SPECIFIC label that fits. If it's an EDM track and the energy drops with snare build-up, call it "build" not "verse". If the bass drops in, call it "drop" not "chorus".
4. Every second of the song must be covered — no gaps between sections.
5. For Indian classical/semi-classical songs, use the Indian terminology.

Output as a JSON array: [{"label": "intro", "start": 0.0, "end": 15.5}, ...]"""

PROMPTS = {
    "caption": "Give a comprehensive musical description of this song. Cover: genre and subgenre, overall mood and emotional arc, instrumentation (every instrument you can identify), production style and techniques, tempo estimate in BPM, time signature, and overall character/vibe.",
    "sections": SECTIONS_PROMPT,
    "chords_timestamped": "Transcribe the chord progression of this song with timestamps. For each chord change, provide the time in seconds and the chord symbol (e.g. Cmaj, Am7, F#dim, Bb/D). Output as a JSON array of objects with keys: time, chord.",
    "key_tempo": "What is the musical key and mode of this song? What is the exact tempo in BPM? Does the tempo or key change at any point? If so, when exactly (give timestamps)? What is the time signature?",
    "instruments": "List every instrument and sound source you can identify in this song. For each, describe: when it enters (timestamp), its role (lead/rhythm/bass/pad/percussion), playing style, and how prominent it is.",
    "voice": "Describe the vocal characteristics: gender, register, singing style, harmonies/backing vocals, vocal effects, emotional delivery, language. If instrumental, say so.",
    "lyrics": "Transcribe the complete lyrics with timestamps. For each line, provide start time in seconds. Include backing vocals in parentheses. If instrumental, say 'Instrumental - no lyrics'.",
    "emotion_trajectory": "Describe the emotional trajectory from start to finish. Rate energy (1-10), valence (1-10), arousal (1-10) per section with timestamps. Identify the emotional climax.",
    "rhythm_groove": "Analyze rhythmic elements: drum patterns, groove feel (straight/swing/shuffle/syncopated), polyrhythmic elements, rhythmic variations between sections.",
    "production": "Analyze production and mixing: stereo width, reverb/delay, compression, frequency balance, dynamic range, notable effects, layering, sonic aesthetic.",
    "deep_analysis": "You are a professional musicologist. Give a thorough musical analysis: harmonic language, melodic contour/motifs, rhythmic complexity, form/structure, orchestration, dynamic shaping, tension/release, and what makes this musically unique. Use timestamps.",
}


if __name__ == "__main__":
    wavs = sorted(glob.glob(os.path.join(WAV_DIR, "*.wav")))
    print(f"MOSS extraction: {len(wavs)} songs x {len(PROMPTS)} prompts", flush=True)

    for i, wav in enumerate(wavs):
        slug = os.path.splitext(os.path.basename(wav))[0]
        out_path = os.path.join(OUT_DIR, f"{slug}.json")
        if os.path.exists(out_path):
            print(f"[{i + 1}/{len(wavs)}] {slug} — skip", flush=True)
            continue

        t0 = time.time()
        print(f"[{i + 1}/{len(wavs)}] {slug}", flush=True)
        results = {}

        for task, prompt in PROMPTS.items():
            tt = time.time()
            ok = False
            for attempt in range(2):
                try:
                    resp = query(wav, prompt)
                    if is_bad(resp):
                        print(f"  {task}: BAD (attempt {attempt + 1})", flush=True)
                        continue
                    results[task] = resp
                    print(
                        f"  {task}: {len(resp)} chars {time.time() - tt:.1f}s",
                        flush=True,
                    )
                    ok = True
                    break
                except Exception as e:
                    print(f"  {task}: ERR {e}", flush=True)
            if not ok:
                print(f"  {task}: SKIPPED", flush=True)

        results["_model"] = "MOSS-Music-8B-Thinking"
        results["_engine"] = "sglang-generate"
        results["_time_s"] = round(time.time() - t0, 1)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)
        print(f"  DONE {slug} in {results['_time_s']:.0f}s", flush=True)

    print("MOSS_DONE", flush=True)
