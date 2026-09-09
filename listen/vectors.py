#!/usr/bin/env python3
"""The learned tier: one MERT embedding per beat. Needs the CUDA venv.

    $LIMELIGHT_PY_AUDIO listen/vectors.py levels [--write]

m-a-p/MERT-v1-95M, last_hidden_state, 74.8 frames/s at 24 kHz. Pooled the way
GPU.md says to: MEAN OF THE FRAMES BETWEEN CONSECUTIVE BEATS, then L2-normalised,
so 126 bpm and 84 bpm give the same sequence length and a reader comparing two
bars compares two bars. float16, row-major, rows = beats, dim = 768. Same schema
as the-nights so one reader handles both.

Not a fact about the song a human could check by ear; a fact about what a large
model heard, which a small head can learn from. That is what the learned tier is
for, and it says so.
"""
import json, os, sys, subprocess, array, time, warnings, math
warnings.filterwarnings("ignore")
import torch, numpy as np
from transformers import AutoModel, Wav2Vec2FeatureExtractor

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
NAME = "m-a-p/MERT-v1-95M"; CHUNK_S = 30.0; OVERLAP_S = 1.0


def decode(path, sr):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr),
                          "-f", "s16le", "-"], stdout=subprocess.PIPE, check=True).stdout
    a = array.array("h"); a.frombytes(out)
    return np.asarray(a, dtype=np.float32) / 32768.0


def frames_for(x, sr, model, proc, dev):
    """Whole song as 74.8 Hz frames, in overlapping chunks so a 4 GB card copes."""
    hop = int(CHUNK_S * sr); ov = int(OVERLAP_S * sr); out = []
    pos = 0
    while pos < len(x):
        a = max(0, pos - ov); b = min(len(x), pos + hop + ov)
        inp = proc(x[a:b], sampling_rate=sr, return_tensors="pt")
        with torch.no_grad():
            h = model(**{k: v.to(dev) for k, v in inp.items()}).last_hidden_state[0].float().cpu().numpy()
        fps = h.shape[0] / ((b - a) / sr)
        lead = int(round((pos - a) / sr * fps)); keep = int(round(min(hop, len(x) - pos) / sr * fps))
        out.append(h[lead:lead + keep]); pos += hop
    H = np.concatenate(out, 0)
    return H, H.shape[0] / (len(x) / sr)


try:
    from mapio import map_path
except ImportError:
    import sys as _s, os as _o
    _s.path.insert(0, _o.path.dirname(_o.path.abspath(__file__)))
    from mapio import map_path


def analyse(slug, write=False):
    mp = map_path(slug)
    wav = os.path.join(ROOT, "synth", "out", slug + ".wav")
    if not mp or not os.path.exists(wav): return {"song": slug, "error": "no map or no audio"}
    m = json.load(open(mp)); beats = m.get("beats") or []
    if len(beats) < 8: return {"song": slug, "error": "no beats"}
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoModel.from_pretrained(NAME, trust_remote_code=True).to(dev).eval()
    proc = Wav2Vec2FeatureExtractor.from_pretrained(NAME, trust_remote_code=True)
    sr = proc.sampling_rate
    t0 = time.time(); x = decode(wav, sr); H, fps = frames_for(x, sr, model, proc, dev)
    rows = []
    edges = list(beats) + [beats[-1] + (beats[-1] - beats[-2])]
    for i in range(len(beats)):
        a, b = int(edges[i] * fps), max(int(edges[i] * fps) + 1, int(edges[i + 1] * fps))
        seg = H[a:min(b, len(H))]
        v = seg.mean(0) if len(seg) else np.zeros(H.shape[1], np.float32)
        n = np.linalg.norm(v); rows.append(v / n if n > 0 else v)
    V = np.stack(rows).astype(np.float16)
    # Reported to the terminal as a sanity read, NOT written to the map: it is a
    # pure function of the sidecar and `sections`, so a reader can compute it.
    secs = m.get("sections"); ents = secs.get("entries") if isinstance(secs, dict) else (secs or [])
    sim = {}
    if ents and len(ents) >= 2:
        names = [chr(65 + i) for i in range(len(ents))]
        starts = [e.get("at", 0.0) for e in ents] + [edges[-1]]
        import bisect
        pooled = []
        for i in range(len(ents)):
            i0, i1 = bisect.bisect_left(beats, starts[i]), bisect.bisect_left(beats, starts[i + 1])
            seg = V[i0:i1].astype(np.float32)
            p = seg.mean(0) if len(seg) else np.zeros(V.shape[1], np.float32)
            n = np.linalg.norm(p); pooled.append(p / n if n > 0 else p)
        for i in range(len(pooled)):
            for j in range(i + 1, len(pooled)):
                sim["%s~%s" % (names[i], names[j])] = round(float(pooled[i] @ pooled[j]), 3)
        sim = dict(sorted(sim.items(), key=lambda kv: -kv[1]))
    # The name of the file and the integrity of the reference belong to
    # listen/sidecar.py -- one writer per fact, and that fact is "which file,
    # made by which revision, holding how many bytes". This writes the data and
    # the things only it knows; sidecar.py names it and measures it.
    import sidecar as SC
    fname = SC.canonical(slug, NAME, SC.revision(NAME), "per_beat", "float16")
    if write:
        V.tofile(os.path.join(os.path.dirname(mp), fname))
        m["vectors"] = {
            "model": NAME, "layer": "last_hidden_state", "rate": "per_beat",
            "rows": int(V.shape[0]), "dim": int(V.shape[1]), "dtype": "float16",
            "layout": "row_major", "file": fname,
            "pooling": "mean of %.1f Hz frames between consecutive beats, then L2-normalised" % fps,
            "not": ("a fact a human can check by ear. It is what a large model heard, "
                    "for a small head to learn from. Also: this torch build renamed the "
                    "weight-norm parametrisation, so the positional-conv weights of the "
                    "checkpoint did not load and are randomly initialised; embeddings are "
                    "slightly perturbed from the published model's. the-nights' vectors "
                    "were made the same way."),
            "device": torch.cuda.get_device_name(0) if dev == "cuda" else "cpu",
        }
        json.dump(m, open(mp, "w"), indent=1); open(mp, "a").write("\n")
        SC.analyse(slug, write=True)          # adds bytes, sha256 and the checks
    return {"song": slug, "rows": int(V.shape[0]), "dim": int(V.shape[1]), "fps": round(fps, 1),
            "secs": round(time.time() - t0, 1), "top_sim": list(sim.items())[:3],
            "wrote": fname if write else None}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]; write = "--write" in sys.argv
    for slug in (args or ["levels", "starlight", "mizhiyoram", "dont-look-down"]):
        r = analyse(slug, write)
        if "error" in r: print("  %-16s %s" % (slug, r["error"])); continue
        print("  %-16s %4d beats x %d  @%.1f fps  %5.1fs   most alike sections: %s%s" %
              (slug, r["rows"], r["dim"], r["fps"], r["secs"],
               " ".join("%s=%.2f" % kv for kv in r["top_sim"]), "  -> " + r["wrote"] if r["wrote"] else ""))
