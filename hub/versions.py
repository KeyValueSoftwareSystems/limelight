"""The version store: every .score keeps every version it was uploaded as.

On disk, beside the file:

    score/levels.score                         a copy of the latest version's bytes
    score/.versions/levels.score/1.score       version 1, exactly as uploaded
    score/.versions/levels.score/2.score
    score/.versions/levels.score/2.meta.json   author metadata for version 2, once somebody adds it

The top-level copy is what keeps every plain GET, the listing, `limelight pull`
and any dufs client working with no idea versions exist. Nothing in here knows
about HTTP; hub.py asks these functions and answers the request.
"""
import json, os

VDIR = ".versions"
EXT = ".score"
META = ".meta.json"


def is_versioned(path):
    return path.endswith(EXT)


def _store(path):
    return os.path.join(os.path.dirname(path), VDIR, os.path.basename(path))


def _write(path, data):
    # Write beside, then rename: a reader never sees half a file.
    tmp = path + ".uploading"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _dump(obj):
    # The formatting of protocol/score.levels.json.
    return json.dumps(obj, indent=1, ensure_ascii=False).encode("utf-8")


def version_path(path, n):
    return os.path.join(_store(path), f"{n}{EXT}")


def meta_path(path, n):
    return os.path.join(_store(path), f"{n}{META}")


def numbers(path):
    """Every version number present, ascending. [] for a file with no history."""
    d = _store(path)
    if not os.path.isdir(d):
        return []
    return sorted(int(f[:-len(EXT)]) for f in os.listdir(d)
                  if f.endswith(EXT) and f[:-len(EXT)].isdigit())


def latest(path):
    ns = numbers(path)
    return ns[-1] if ns else None


def store(path, data):
    """Write data as the next version and copy it to the top level. Returns N."""
    os.makedirs(_store(path), exist_ok=True)
    n = (latest(path) or 0) + 1
    _write(version_path(path, n), data)
    _write(path, data)
    return n


def resolve_version(path, v):
    """A query value ('' or None for latest, else digits) -> an existing N, or KeyError."""
    if v in (None, ""):
        n = latest(path)
    elif str(v).isdigit():
        n = int(v)
    else:
        raise KeyError(v)
    if n is None or not os.path.isfile(version_path(path, n)):
        raise KeyError(v)
    return n


def parse_object(data):
    """bytes -> dict when the bytes are a JSON object, else None."""
    try:
        obj = json.loads(data)
    except ValueError:
        return None
    return obj if isinstance(obj, dict) else None


def get_meta(path, n):
    """The stored metadata object for version n, or None when none was added."""
    p = meta_path(path, n)
    if not os.path.isfile(p):
        return None
    with open(p, "rb") as f:
        return json.load(f)


def set_meta(path, n, data):
    """Store metadata for version n. Raises ValueError with the reason when the
    body is not a JSON object; nothing is written in that case."""
    try:
        obj = json.loads(data)
    except ValueError as e:
        raise ValueError(f"metadata is not JSON: {e}")
    if not isinstance(obj, dict):
        raise ValueError("metadata must be a JSON object")
    _write(meta_path(path, n), _dump(obj))
    return obj


def read(path, n, raw=False):
    """The bytes of version n. Unless raw, metadata is folded in under
    author_metadata -- but only when there is metadata and the file is a JSON
    object; otherwise the uploaded bytes come back exactly."""
    with open(version_path(path, n), "rb") as f:
        data = f.read()
    if raw:
        return data
    meta = get_meta(path, n)
    if meta is None:
        return data
    obj = parse_object(data)
    if obj is None:
        return data
    obj["author_metadata"] = meta
    return _dump(obj)


def history(path):
    out = []
    for n in numbers(path):
        vp = version_path(path, n)
        st = os.stat(vp)
        with open(vp, "rb") as f:
            mergeable = parse_object(f.read()) is not None
        out.append({"version": n, "size": st.st_size, "mtime": int(st.st_mtime * 1000),
                    "has_metadata": os.path.isfile(meta_path(path, n)), "mergeable": mergeable})
    return {"name": os.path.basename(path), "latest": latest(path), "versions": out}
