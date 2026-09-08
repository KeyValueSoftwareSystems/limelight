"""Essentia L3 worker — runs in the `limelight-ess` env, not the main env.

Standalone: imports only essentia + numpy, reads audio from a path, computes one
discogs-effnet embedding, runs the classifier heads on it, and prints a compact
semantic JSON to stdout.

    python essentia_worker.py <audio_path> <models_dir>
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

EMBED_PB = "discogs-effnet-bs64-1.pb"
HEADS = [
    "danceability", "voice_instrumental",
    "mood_happy", "mood_sad", "mood_aggressive", "mood_relaxed", "mood_party",
    "genre_discogs400",
]


def _nodes(meta: dict) -> tuple[str, str]:
    schema = (meta or {}).get("schema", {})
    ins = schema.get("inputs") or [{}]
    outs = schema.get("outputs") or [{}]
    return (ins[0].get("name") or "serving_default_model_Placeholder",
            outs[0].get("name") or "PartitionedCall")


def _positive_index(classes: list[str]) -> int:
    for i, name in enumerate(classes):
        low = name.lower()
        if not (low.startswith("non") or low.startswith("not")):
            return i
    return 0


def main() -> int:
    audio_path, models_dir = sys.argv[1], sys.argv[2]
    import essentia.standard as es

    audio = es.MonoLoader(filename=audio_path, sampleRate=16000, resampleQuality=4)()
    embeddings = es.TensorflowPredictEffnetDiscogs(
        graphFilename=os.path.join(models_dir, EMBED_PB), output="PartitionedCall:1"
    )(audio)

    out: dict = {"status": "ok", "backend": "essentia-tensorflow / discogs-effnet",
                 "mood": {}, "models": {"embedding": EMBED_PB}}

    for head in HEADS:
        pb = os.path.join(models_dir, f"{head}-discogs-effnet-1.pb")
        js = os.path.join(models_dir, f"{head}-discogs-effnet-1.json")
        if not os.path.exists(pb):
            continue
        try:
            meta = json.load(open(js)) if os.path.exists(js) else {}
            classes = meta.get("classes") or []
            in_node, out_node = _nodes(meta)
            preds = es.TensorflowPredict2D(graphFilename=pb, input=in_node, output=out_node)(embeddings)
            mean = np.asarray(preds).mean(axis=0)
            out["models"][head] = os.path.basename(pb)

            if head == "genre_discogs400":
                order = np.argsort(mean)[::-1][:5]
                out["genre_top"] = [[classes[i] if i < len(classes) else str(i), round(float(mean[i]), 4)]
                                    for i in order]
            elif head == "danceability":
                out["danceability"] = round(float(mean[_positive_index(classes)]), 4)
            elif head == "voice_instrumental":
                idx = classes.index("voice") if "voice" in classes else _positive_index(classes)
                out["voice"] = round(float(mean[idx]), 4)
            elif head.startswith("mood_"):
                out["mood"][head[len("mood_"):]] = round(float(mean[_positive_index(classes)]), 4)
        except Exception as exc:  # noqa: BLE001
            out.setdefault("errors", {})[head] = f"{type(exc).__name__}: {exc}"

    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
