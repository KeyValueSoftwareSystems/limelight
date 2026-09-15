import re

BPM = re.compile(
    r"(?:\s*[-,(]\s*)?\b(?:at\s+|a\s+|its\s+|with\s+a\s+)?"
    r"\d{2,3}(?:\.\d+)?\s*(?:bpm|beats\s+per\s+minute)(?:\s*[-,)])?",
    re.I,
)
KEY = re.compile(
    r"(?:\s*[-,(]\s*)?\b(?:written\s+|set\s+|centered\s+|rooted\s+)?"
    r"(?:in|the\s+key\s+of)\s+[A-G][#b♯♭]?\s*"
    r"(?:major|minor|maj|min|dorian|mixolydian|phrygian|lydian|aeolian|ionian)"
    r"(?:\s*[-,)])?",
    re.I,
)


def strip_claims(caption):
    if not caption:
        return caption
    out = KEY.sub(" ", BPM.sub(" ", caption))
    out = re.sub(r"\s*,\s*,", ",", out)
    out = re.sub(r"\(\s*\)", "", out)
    out = re.sub(r"\s+([,.;])", r"\1", out)
    out = re.sub(r"\s*,\s*\.", ".", out)
    return re.sub(r"\s{2,}", " ", out).strip()
