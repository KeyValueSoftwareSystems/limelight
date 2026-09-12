"""A personality: how one artist wants their show to look for one song.

Two human layers sit on a score and they are not the same thing. The author's
layer is metadata (versions.py) -- what Amal measured, optionally marked as
enforced, which a reader is obliged to respect. This is the artist's layer: what
the person playing the song wants done with it. For now that is a palette, and
the palette is per song on purpose. One palette across a whole set would make
twenty tracks look like one, which is the opposite of having a personality.

    score/.versions/levels.score/personalities/sarath.json
        {"user": "sarath", "colours": ["magenta", "cyan"]}

The file stores colour NAMES and the hex comes from the palette on read, so
changing a palette entry reaches every personality at once.

Personalities are public: anyone on the network can read or change any of them.

Note on the word. In lighting, "personality" already means a fixture's channel
map, and we have those under readers/lights/drivers/ where they are called
profiles. They are a different thing and keep their own name. If you are reading
this from the lighting side: a driver profile describes a lamp, a personality
describes a person.
"""
import json, os, re

PALETTE = [("red", "#ff0000"), ("green", "#00ff00"), ("blue", "#0000ff"), ("yellow", "#ffff00"),
           ("cyan", "#00ffff"), ("magenta", "#ff00ff"), ("white", "#ffffff")]
HEX = dict(PALETTE)
USER = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
USER_RULE = "user name must be 1-40 characters of letters, digits, _ or -"
PDIR = "personalities"
OLD_PDIR = "profiles"        # what this was called before; still read, never written


def colours():
    return [{"name": n, "hex": h} for n, h in PALETTE]


def valid_user(user):
    return bool(USER.match(user or ""))


def _dir(path, which=PDIR):
    return os.path.join(os.path.dirname(path), ".versions", os.path.basename(path), which)


def _file(path, user):
    """Where this user's personality lives, preferring one already saved.

    A personality saved before the rename sits under profiles/. Read it where it
    is rather than losing somebody's colours to a word change; new writes always
    go to personalities/.
    """
    new = os.path.join(_dir(path), user + ".json")
    if os.path.isfile(new):
        return new
    old = os.path.join(_dir(path, OLD_PDIR), user + ".json")
    return old if os.path.isfile(old) else new


def _shape(raw):
    return {"user": raw["user"],
            "colours": [{"name": c, "hex": HEX.get(c)} for c in raw["colours"]]}


def get(path, user):
    """One personality as {user, colours: [{name, hex}, ...]}, or None."""
    if not valid_user(user):
        return None
    p = _file(path, user)
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        return _shape(json.load(f))


def all_of(path):
    """Every personality saved for this score, one per user, sorted by user."""
    seen, out = set(), []
    for which in (PDIR, OLD_PDIR):
        d = _dir(path, which)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if not fn.endswith(".json") or fn[:-5] in seen:
                continue
            seen.add(fn[:-5])
            with open(os.path.join(d, fn), encoding="utf-8") as f:
                out.append(_shape(json.load(f)))
    return sorted(out, key=lambda p: p["user"])


def put(path, user, body):
    """Create or replace. Raises ValueError with the reason; writes nothing then."""
    if not valid_user(user):
        raise ValueError(USER_RULE)
    try:
        obj = json.loads(body)
    except ValueError as e:
        raise ValueError(f"personality is not JSON: {e}")
    if not isinstance(obj, dict):
        raise ValueError('personality must be a JSON object like {"colours": ["red", "blue"]}')
    if "colours" not in obj:
        raise ValueError("colours is missing")
    colours = obj["colours"]
    if not isinstance(colours, list):
        raise ValueError("colours must be a list of names")
    if not colours:
        raise ValueError("colours needs at least one")
    for c in colours:
        if c not in HEX:
            raise ValueError(f"{c!r}: colour must be one of: " + ", ".join(HEX))
    if len(set(colours)) != len(colours):
        raise ValueError("a colour is repeated")
    os.makedirs(_dir(path), exist_ok=True)
    target = os.path.join(_dir(path), user + ".json")
    tmp = target + ".uploading"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"user": user, "colours": colours}, f, indent=1)
    os.replace(tmp, target)
    return get(path, user)


def embed(obj, personality):
    obj["personality"] = personality
    return obj
