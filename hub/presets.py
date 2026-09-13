"""Presets on the hub: a short stretch of a real song, ready to test one thing.

A preset folder holds the audio for a passage, the protocol response for exactly
that passage, and a manifest saying what musical facts are inside it -- a build,
a tempo change, returning material, how heavy its biggest moment is. The facts
are read from the response when the preset is built, not asserted by hand.

    presets/<name>/preset.json     the manifest, including `contains`
    presets/<name>/response.json   the request and the response, verbatim
    presets/<name>/clip.wav        the audio, if the builder had it

The point of `contains` is that an app which has never heard of these songs can
ask for what it needs. A game testing whether it follows tempo changes asks for
presets containing one; it does not need to know the track, the bars, or who cut
it. That is what makes this a platform library rather than a lighting fixture.

    GET /hub/presets/?json                 every preset with its manifest
    GET /hub/presets/?has=build,returns    only those containing all of them
    GET /hub/presets/<name>/<file>         a file from one preset
"""
import json, os

PDIR = "presets"

# what a caller may ask for, and the manifest key behind it
WANTS = {
    "build": "has_build",
    "tempo-change": "has_tempo_change",
    "returns": "has_returning_material",
    "riff-returns": "has_returning_riff",
    "pace-rises": "pace_rises",
    "silence": "has_silence",
}


def root(hub_root):
    return os.path.join(hub_root, PDIR)


def _manifest(d):
    at = os.path.join(d, "preset.json")
    if not os.path.isfile(at):
        return None
    try:
        with open(at, encoding="utf-8") as f:
            m = json.load(f)
    except ValueError:
        return None
    m["files"] = sorted(n for n in os.listdir(d) if not n.startswith("."))
    m["has_audio"] = any(n.endswith((".wav", ".mp3")) for n in m["files"])
    return m


def all_of(hub_root):
    """Every preset that has a readable manifest, by name."""
    base = root(hub_root)
    if not os.path.isdir(base):
        return []
    out = []
    for name in sorted(os.listdir(base)):
        d = os.path.join(base, name)
        if not os.path.isdir(d):
            continue
        m = _manifest(d)
        if m:
            m.setdefault("name", name)
            out.append(m)
    return out


def matching(hub_root, wants):
    """Presets containing ALL of the named facts.

    An unknown name is reported rather than quietly matching nothing, because a
    typo that returns an empty list looks exactly like "we have none of those".
    """
    unknown = [w for w in wants if w not in WANTS]
    # A name we do not know cannot be satisfied, so it matches nothing. Skipping
    # it instead would answer a question nobody asked -- and the caller would
    # read the result as "yes, we have presets with that".
    if unknown:
        return [], unknown
    keep = []
    for m in all_of(hub_root):
        c = m.get("contains") or {}
        if all(c.get(WANTS[w]) for w in wants):
            keep.append(m)
    return keep, unknown


def can_ask_for():
    return sorted(WANTS)
