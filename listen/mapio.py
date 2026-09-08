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
