"""Where the map for a slug lives. One answer, in one place.

Seven writers each carried a private copy of this and every copy hard-coded
maps/model. The repo has already paid for that shape once -- a song was renamed
and the rooms page broke, because the name was written down twice. Here it was
written down seven times, and the cost was different: the whole enrichment
pipeline could only ever write to one directory, so a map could not be built
anywhere else. That is what made it impossible to run our own listener over The
Nights without overwriting somebody else's file.

Our maps live in synth/maps/amal, one folder per person alongside beats/ and
dheeraj/, which is the layout the board and the editor already discover. They
used to sit in maps/model, which is not a person, and the one map in there that
belongs to somebody else got written over once because of it.

LIMELIGHT_MAPS overrides the map search path, os.pathsep separated, first match
wins. LIMELIGHT_WORK says where the big generated things live -- separated stems,
cloned model repos, virtualenvs -- none of which belong in git. It defaults to
`work/` in the repo, which is gitignored. Every tool that needs a stem asks here,
so a teammate sets one variable rather than editing eight files.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def map_dirs():
    env = os.environ.get("LIMELIGHT_MAPS")
    if not env:
        return [os.path.join(ROOT, "synth", "maps", "amal")]
    return [d if os.path.isabs(d) else os.path.join(ROOT, d)
            for d in env.split(os.pathsep) if d]


def map_path(slug, must_exist=True):
    """The map to read and write for this slug, or None if there is not one."""
    for d in map_dirs():
        for name in (slug + ".full.map.json", slug + ".map.json"):
            p = os.path.join(d, name)
            if os.path.exists(p):
                return p
    if must_exist:
        return None
    return os.path.join(map_dirs()[0], slug + ".map.json")


def work_dir():
    """Where the big generated things live. Not in git, never in git."""
    return os.environ.get("LIMELIGHT_WORK") or os.path.join(ROOT, "work")


def stems_dir():
    """The separator's output: <stems>/<slug>/{vocals,drums,bass,guitar,piano,other}.mp3"""
    return os.environ.get("LIMELIGHT_STEMS") or os.path.join(
        work_dir(), "stems", "htdemucs_6s")


def stem_path(slug, stem):
    """One stem, or None. Accepts either extension, because demucs can write both."""
    for ext in (".mp3", ".wav"):
        p = os.path.join(stems_dir(), slug, stem + ext)
        if os.path.exists(p):
            return p
    return None


def chordmini_dir():
    return os.environ.get("LIMELIGHT_CHORDMINI") or os.path.join(work_dir(), "chordmini")


# ---------------------------------------------------------------------------
# Where the RELEASE audio for a slug lives.
#
# This was written down twice -- listen/stereo.py carried a dict of five
# filenames and listen/identify.py carried its own copy of the same five with
# artist and title bolted on. AGENTS.md already names that shape as a mistake
# the repo has paid for ("hard-coding a name in two places"), and it bit again
# the moment held-out songs arrived: a track fetched into synth/incoming was
# invisible to one tool and visible to the other.
#
# The registry below is still a list of names, because a file called
# "The Nights.mp3" cannot be derived from the slug "the-nights" by any rule
# worth trusting. What changed is that there is one of it, and that anything
# not in it is discovered from disk instead of being unsupported.

RELEASES = {
    "levels":         ("Avicii - Levels (Radio Edit).mp3", "Avicii", "Levels (Radio Edit)"),
    "starlight":      ("Martin Garrix, DubVision feat. Shaun Farrugia - Starlight (Keep Me Afloat) [Official Video].mp3",
                       "Martin Garrix, DubVision feat. Shaun Farrugia", "Starlight (Keep Me Afloat)"),
    "dont-look-down": ("Martin Garrix feat. Usher - Don't Look Down (Lyric Video).mp3",
                       "Martin Garrix feat. Usher", "Don't Look Down"),
    "mizhiyoram":     ("Mizhiyoram -  Manjil Virinja Pookkal  Lofi Mix  Prazz Mu6.mp3",
                       "Prazz Mu6", "Mizhiyoram (Manjil Virinja Pookkal Lofi Mix)"),
    "the-nights":     ("The Nights.mp3", "Avicii", "The Nights"),
}

AUDIO_EXT = (".wav", ".mp3", ".flac", ".m4a", ".ogg", ".opus")


def release_path(slug):
    """The stereo release this map was built from, or None.

    Order matters: a name in the registry wins, then anything sitting in
    synth/incoming under that slug, at any depth. The recursive walk is what
    lets tools/mkheldout.py drop tracks into a subfolder without every reader
    needing to know the subfolder exists.
    """
    named = RELEASES.get(slug, (None,))[0]
    if named:
        p = os.path.join(ROOT, named)
        if os.path.exists(p):
            return p
    incoming = os.path.join(ROOT, "synth", "incoming")
    for base, _dirs, files in os.walk(incoming):
        for ext in AUDIO_EXT:
            p = os.path.join(base, slug + ext)
            if os.path.exists(p):
                return p
    return None


def release_credit(slug):
    """(artist, title) as printed on the release, or (None, None).

    Stated, never measured. For a fetched track the catalogue beside it is the
    authority, because that is what the licence attribution has to match.
    """
    if slug in RELEASES:
        return RELEASES[slug][1], RELEASES[slug][2]
    cat = os.path.join(ROOT, "songs", "heldout", "HELDOUT.json")
    if os.path.exists(cat):
        try:
            import json
            for t in json.load(open(cat))["tracks"]:
                if t["slug"] == slug:
                    return t.get("creator"), t.get("title")
        except Exception:
            pass
    return None, None
