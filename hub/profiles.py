"""A profile: how one user's application treats a score.

The author's layer is metadata (versions.py): fields with an enforce flag,
folded into a download as x- keys. This is the consumer's layer. For now a
profile is a user name and one or more colours from a fixed palette, and profiles are
public: anyone on the network can add or change any of them.

    score/.versions/levels.score/profiles/muzammil.json    {"user": "muzammil", "colours": ["red", "blue"]}

The file stores colour NAMES; the hex comes from the palette on read, so a
palette change reaches every profile at once. Nothing here knows about HTTP.
"""
import json, os, re

PALETTE = [("red", "#ff0000"), ("green", "#00ff00"), ("blue", "#0000ff"), ("yellow", "#ffff00"),
           ("cyan", "#00ffff"), ("magenta", "#ff00ff"), ("white", "#ffffff")]
HEX = dict(PALETTE)
USER = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
USER_RULE = "user name must be 1-40 characters of letters, digits, _ or -"
PDIR = "profiles"


def colours():
    return [{"name": n, "hex": h} for n, h in PALETTE]


def valid_user(user):
    return bool(USER.match(user or ""))


def _dir(path):
    return os.path.join(os.path.dirname(path), ".versions", os.path.basename(path), PDIR)


def _file(path, user):
    return os.path.join(_dir(path), user + ".json")


def _shape(raw):
    return {"user": raw["user"], "colours": [{"name": c, "hex": HEX.get(c)} for c in raw["colours"]]}


def get(path, user):
    """One profile as {user, colours: [{name, hex}, ...]}, or None."""
    if not valid_user(user):
        return None
    p = _file(path, user)
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        return _shape(json.load(f))


def all_of(path):
    """Every profile of this score, sorted by user."""
    d = _dir(path)
    if not os.path.isdir(d):
        return []
    out = []
    for fn in sorted(os.listdir(d)):
        if fn.endswith(".json"):
            with open(os.path.join(d, fn), encoding="utf-8") as f:
                out.append(_shape(json.load(f)))
    return out


def put(path, user, body):
    """Create or replace. Raises ValueError with the reason; writes nothing then."""
    if not valid_user(user):
        raise ValueError(USER_RULE)
    try:
        obj = json.loads(body)
    except ValueError as e:
        raise ValueError(f"profile is not JSON: {e}")
    if not isinstance(obj, dict):
        raise ValueError('profile must be a JSON object like {"colours": ["red", "blue"]}')
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
    target = _file(path, user)
    tmp = target + ".uploading"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"user": user, "colours": colours}, f, indent=1)
    os.replace(tmp, target)
    return get(path, user)


def embed(obj, profile):
    obj["profile"] = profile
    return obj
