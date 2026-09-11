"""L4 — zero-shot text-audio alignment via MuQ-MuLan.

MuQ-MuLan maps audio and text into a shared embedding space. A fixed text
vocabulary — moment kinds, mood terms — is compared against per-section audio
embeddings via cosine similarity. The result is a measurement, not a preset:
the SONG decides where it sits among the words.

Moment candidates go to events (the same list port.py already reads); mood
scores go to a dedicated MusicState key that port.py lifts into observations.
"""
from __future__ import annotations

import logging

import numpy as np

from ..config import MUQMULAN_MODEL, MUQ_SR
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.muqmulan")

# The six moment kinds and their text descriptions.
# The prompts were chosen to be music-structural, never lighting-specific.
MOMENT_PROMPTS = [
    ("drop", "a dramatic musical drop, impact, or climax"),
    ("build", "building musical tension, rising energy, anticipation"),
    ("stop", "sudden silence, a stop or break in the music"),
    ("quiet", "quiet, subdued, minimal musical passage"),
    ("spotlight", "a solo instrument or voice featured prominently"),
    ("return", "returning to a familiar musical theme or motif"),
]

MOOD_TERMS = [
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
MOOD_KEYS = [
    "euphoric", "dark", "sad", "tender", "driving",
    "calm", "warm", "cold", "triumphant", "tense",
]

MAX_SEGMENT_S = 10.0  # MuQ-MuLan max input length per forward pass


class MuQMuLanAnalyzer(Analyzer):
    name = "muq-mulan"
    level = "L4"

    def available(self) -> tuple[bool, str]:
        try:
            import torch  # noqa: F401
            from muq import MuQMuLan  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            return False, f"torch/muq missing ({exc.__class__.__name__})"
        return True, ""

    def analyze(self, audio, sample_rate, ctx):
        import librosa
        import torch
        from muq import MuQMuLan

        dev = "cuda" if torch.cuda.is_available() else "cpu"
        mulan = MuQMuLan.from_pretrained(MUQMULAN_MODEL).to(dev).eval()
        resampled = librosa.resample(audio, orig_sr=sample_rate, target_sr=MUQ_SR)

        # precompute text embeddings (one-off, cheap)
        with torch.no_grad():
            moment_texts = [p for _, p in MOMENT_PROMPTS]
            moment_text_embs = mulan(texts=moment_texts)
            mood_text_embs = mulan(texts=MOOD_TERMS)

        # derive sections from downbeats: groups of 4 bars
        spans = _sections_from_ctx(ctx, len(resampled) / MUQ_SR)

        # embed each audio section
        moment_events = []
        mood_rows = []
        for a, b in spans:
            seg = resampled[int(a * MUQ_SR):int(min(b, a + MAX_SEGMENT_S) * MUQ_SR)]
            if len(seg) < int(0.5 * MUQ_SR):
                mood_rows.append(None)
                continue
            with torch.no_grad():
                audio_emb = mulan(wavs=torch.tensor(seg).unsqueeze(0).to(dev))

                moment_sims = mulan.calc_similarity(audio_emb, moment_text_embs)
                moment_scores = moment_sims[0].float().cpu().tolist()

                mood_sims = mulan.calc_similarity(audio_emb, mood_text_embs)
                mood_rows.append(mood_sims[0].float().cpu().tolist())

            # peak-pick moments: emit event if similarity is above threshold
            for i, (kind, _) in enumerate(MOMENT_PROMPTS):
                score = moment_scores[i]
                if score >= 0.25:
                    moment_events.append({
                        "t": round(a, 3), "type": kind,
                        "conf": round(float(min(1.0, max(0.0, score))), 3),
                        "how": "muq-mulan zero-shot",
                    })

        del mulan
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        # normalise mood: scale each term to 0-1 across sections
        mood_data = _normalise_mood(mood_rows, [a for a, _ in spans])

        patch: dict = {}
        if moment_events:
            patch["events"] = moment_events
        if mood_data:
            patch["muqmulan_mood"] = mood_data

        n_moments = len(moment_events)
        n_mood = len([r for r in mood_rows if r])
        notes = f"MuQ-MuLan zero-shot: {n_moments} moment candidates, mood for {n_mood} sections"

        return AnalyzerResult(
            status="ok",
            patch=patch,
            confidence={"muqmulan_mood": 0.7},
            notes=notes,
        )


def _sections_from_ctx(ctx, duration):
    """Derive analysis sections from downbeats (groups of 4 bars = 16 downbeats).

    Falls back to 8-second windows when downbeats are not available.
    """
    downbeats = ctx.get("downbeats") or []
    if len(downbeats) >= 8:
        spans = []
        step = max(4, len(downbeats) // max(1, int(duration / 8)))
        for i in range(0, len(downbeats), step):
            a = downbeats[i]
            b = downbeats[min(i + step, len(downbeats) - 1)]
            if i + step >= len(downbeats):
                b = duration
            if b - a >= 2.0:
                spans.append((a, b))
        return spans

    spans = []
    step = 8.0
    t = 0.0
    while t < duration:
        b = min(t + step, duration)
        if b - t >= 2.0:
            spans.append((t, b))
        t = b
    return spans


def _normalise_mood(raw_rows, section_times):
    """Scale each mood term to 0-1 across the song so sections are comparable."""
    have = [r for r in raw_rows if r]
    if not have:
        return None
    n = len(MOOD_KEYS)
    lo = [min(r[i] for r in have) for i in range(n)]
    hi = [max(r[i] for r in have) for i in range(n)]
    rows = []
    for r in raw_rows:
        if not r:
            rows.append([0.5] * n)
            continue
        rows.append([
            round((r[i] - lo[i]) / ((hi[i] - lo[i]) or 1.0), 4)
            for i in range(n)
        ])
    return {
        "rate": "per_section",
        "unit": "0-1 per term across the song, so a section can be MORE euphoric than another",
        "how": (f"{MUQMULAN_MODEL} joint music/text embedding, up to {MAX_SEGMENT_S:.0f}s from "
                "each section compared against a fixed vocabulary"),
        "not": ("not a colour and not an instruction. It says where the music sits among "
                "these words; what a rig does about that is the reader's business"),
        "terms": MOOD_KEYS,
        "at": [round(t, 3) for t in section_times],
        "value": rows,
    }
