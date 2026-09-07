"""What a song is like, from a model that has heard a lot of music.

    python3 listen/deep.py <slug> <stem-dir> <map-in> <map-out>

Three facts this cannot measure with a filter, and one that only a model can:

  mood     MuQ-MuLan embeds music and TEXT into one space, so a section can be
           compared against words. It answers "how close is this to euphoric,
           to tender, to menacing" with a number, per section, and that is a
           measurement rather than a preset. Nothing here names a colour.
  novelty  MuQ frame embeddings, cosine distance across a bar-wide window.
           Where the sound of the music changes, whether or not it got louder.
  lyrics   Whisper on the separated vocal, for word times.

The mood words are a fixed vocabulary, not a per-song choice, the same way a gel
book is fixed: the SONG decides where it sits among them. A reader may map them
to light however it likes -- that mapping is the reader's business and stays out
of the map.
"""
import json, os, sys, math

MOOD = [
    "euphoric, uplifting, joyful music",
    "dark, menacing, aggressive music",
    "sad, melancholy, mournful music",
    "tender, intimate, gentle music",
    "driving, relentless, high energy music",
    "calm, spacious, ambient music",
    "warm, nostalgic, golden music",
    "cold, icy, distant music",
    "triumphant, heroic, anthemic music",
    "tense, uneasy, suspenseful music",
]
MOOD_KEY = ["euphoric", "dark", "sad", "tender", "driving",
            "calm", "warm", "cold", "triumphant", "tense"]
SR = 24000


def sections(m):
    ch = m.get("chapters") or []
    dur = (m.get("song") or {}).get("length") or 0
    out = []
    for i, c in enumerate(ch):
        a = c.get("at", 0.0)
        b = ch[i + 1]["at"] if i + 1 < len(ch) else dur
        if b - a >= 2.0:
            out.append((a, b))
    return out


def mood_for(path, spans):
    import torch, librosa
    from muq import MuQMuLan
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    mulan = MuQMuLan.from_pretrained("OpenMuQ/MuQ-MuLan-large").to(dev).eval()
    y, _ = librosa.load(path, sr=SR, mono=True)
    with torch.no_grad():
        txt = mulan(texts=MOOD)
    raw = []
    for a, b in spans:
        seg = y[int(a * SR):int(min(b, a + 10.0) * SR)]
        if len(seg) < SR:
            raw.append(None)
            continue
        with torch.no_grad():
            emb = mulan(wavs=torch.tensor(seg).unsqueeze(0).to(dev))
            raw.append(mulan.calc_similarity(emb, txt)[0].float().cpu().tolist())
    have = [r for r in raw if r]
    rows = []
    if have:
        n = len(MOOD)
        lo = [min(r[i] for r in have) for i in range(n)]
        hi = [max(r[i] for r in have) for i in range(n)]
        for r in raw:
            if not r:
                rows.append([0.5] * n)
                continue
            rows.append([round((r[i] - lo[i]) / ((hi[i] - lo[i]) or 1.0), 4) for i in range(n)])
    del mulan
    torch.cuda.empty_cache() if torch.cuda.is_available() else None
    return rows


def novelty_for(path, times, win):
    import torch, librosa, numpy as np
    from muq import MuQ
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    muq = MuQ.from_pretrained("OpenMuQ/MuQ-large-msd-iter").to(dev).eval()
    y, _ = librosa.load(path, sr=SR, mono=True)
    feats, step = [], 10.0
    for s in np.arange(0, len(y) / SR, step):
        seg = y[int(s * SR):int((s + step) * SR)]
        if len(seg) < SR:
            break
        with torch.no_grad():
            out = muq(torch.tensor(seg).unsqueeze(0).to(dev), output_hidden_states=False)
        h = out.last_hidden_state[0].float().cpu().numpy()
        feats.append((s, h))
    del muq
    torch.cuda.empty_cache() if torch.cuda.is_available() else None
    if not feats:
        return []
    rate = feats[0][1].shape[0] / step
    allh = np.concatenate([h for _, h in feats], axis=0)
    n = allh.shape[0]
    w = max(1, int(win * rate))
    nov = np.zeros(n)
    for i in range(w, n - w):
        a = allh[i - w:i].mean(axis=0)
        b = allh[i:i + w].mean(axis=0)
        na, nb = np.linalg.norm(a), np.linalg.norm(b)
        nov[i] = 1.0 - float(a @ b / (na * nb)) if na > 1e-9 and nb > 1e-9 else 0.0
    peak = nov.max() or 1.0
    nov = nov / peak
    out = []
    for t in times:
        i = int(t * rate)
        out.append(round(float(nov[i]) if 0 <= i < n else 0.0, 4))
    return out


def lyrics_for(path):
    import whisper, torch
    model = whisper.load_model("small", device="cuda" if torch.cuda.is_available() else "cpu")
    r = model.transcribe(path, word_timestamps=True, verbose=False)
    words = []
    for seg in r.get("segments") or []:
        for w in seg.get("words") or []:
            txt = str(w.get("word", "")).strip()
            if txt:
                words.append({"at": round(float(w["start"]), 3),
                              "to": round(float(w["end"]), 3), "word": txt})
    del model
    torch.cuda.empty_cache() if torch.cuda.is_available() else None
    return words, r.get("language")


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        return 2
    slug, stem_dir, map_in, map_out = sys.argv[1:5]
    m = json.load(open(map_in))
    mix = os.path.join("synth", "out", slug + ".wav")
    voc = os.path.join(stem_dir, slug, "vocals.mp3")
    ob = dict(m.get("observations") or {})
    curve = m.get("energy") or []
    bar = (m.get("grid") or {}).get("period", 0.5) * 4

    spans = sections(m)
    if spans:
        rows = mood_for(mix, spans)
        ob["mood"] = {
            "rate": "per_section",
            "unit": "0-1 per term across the song, so a section can be MORE euphoric than another",
            "how": "MuQ-MuLan-large joint music/text embedding, up to 10 s from each "
                   "section compared against a fixed vocabulary",
            "not": "not a colour and not an instruction. It says where the music sits "
                   "among these words; what a rig does about that is the reader's business",
            "terms": MOOD_KEY,
            "at": [round(a, 3) for a, _ in spans],
            "value": rows,
        }
    if curve:
        nov = novelty_for(mix, [t for t, _ in curve], bar)
        if nov:
            ob["novelty"] = {
                "rate": "per_downbeat",
                "unit": "0-1, 1 = the biggest change in this song",
                "how": "cosine distance between MuQ-large frame embeddings averaged over "
                       "one bar either side",
                "not": "not loudness. This rises where the music CHANGES, which is often "
                       "where nothing gets louder",
                "at": [round(t, 3) for t, _ in curve],
                "value": nov,
            }
    if os.path.exists(voc):
        words, lang = lyrics_for(voc)
        if words:
            ob["lyrics"] = {
                "how": "Whisper small with word timestamps, on the separated vocal stem",
                "language": lang,
                "not": "the words are unreliable on a sung separated stem; the TIMES are "
                       "what a reader should trust",
                "words": words,
            }
    m["observations"] = ob
    mb = dict(m.get("made_by") or {})
    note = str(mb.get("note", "")).split(" | mood, novelty")[0]
    mb["note"] = (note + " | mood, novelty and lyrics from MuQ-MuLan, MuQ-large and "
                         "Whisper").strip(" |")
    m["made_by"] = mb
    json.dump(m, open(map_out, "w"))
    print("%-16s mood %s  novelty %s  lyrics %s"
          % (slug,
             len((ob.get("mood") or {}).get("value") or []),
             len((ob.get("novelty") or {}).get("value") or []),
             len((ob.get("lyrics") or {}).get("words") or [])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
