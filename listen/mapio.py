"""Where the map for a slug lives. One answer, in one place.

Seven writers each carried a private copy of this and every copy hard-coded
maps/model. The repo has already paid for that shape once -- a song was renamed
and the rooms page broke, because the name was written down twice. Here it was
written down seven times, and the cost was different: the whole enrichment
pipeline could only ever write to one directory, so a map could not be built
anywhere else. That is what made it impossible to run our own listener over The
Nights without overwriting somebody else's file.

LIMELIGHT_MAPS overrides the search path, os.pathsep separated, first match wins.
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def map_dirs():
    env = os.environ.get("LIMELIGHT_MAPS")
    if not env:
        return [os.path.join(ROOT, "maps", "model")]
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
