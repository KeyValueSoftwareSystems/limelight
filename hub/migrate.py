"""Move hub-root songs into score/, and mp3s into audio/.

CLI, docs and LIMELIGHT_REMOTE all use /hub/score/. Older layouts left
*.score, *.mp3 and .versions/ at HUB_ROOT (or mp3s beside scores). This
migrator is idempotent.
"""
import filecmp
import os

SCORE_DIR = "score"
AUDIO_DIR = "audio"
VDIR = ".versions"


def _move_file(src, dest, conflicts, label):
    """Place src at dest. Returns 'moved' | 'skipped' | 'conflict'."""
    if not os.path.isfile(src):
        return "skipped"
    if not os.path.exists(dest):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        os.replace(src, dest)
        return "moved"
    if filecmp.cmp(src, dest, shallow=False):
        os.remove(src)
        return "skipped"
    # keep newer as dest; park the other
    src_m, dest_m = os.path.getmtime(src), os.path.getmtime(dest)
    bak = dest + ".root-bak"
    if src_m > dest_m:
        if os.path.exists(bak):
            bak = dest + ".root-bak-" + str(int(src_m))
        os.replace(dest, bak)
        os.replace(src, dest)
        conflicts.append(f"{label}: kept newer root copy; old file → {os.path.basename(bak)}")
    else:
        if os.path.exists(bak):
            bak = dest + ".root-bak-" + str(int(src_m))
        os.replace(src, bak)
        conflicts.append(f"{label}: kept existing copy; other → {os.path.basename(bak)}")
    return "conflict"


def _merge_version_dir(src_dir, dest_dir, conflicts, name):
    """Move version history; never overwrite an existing N.score / meta / profile."""
    if not os.path.isdir(src_dir):
        return "skipped"
    if not os.path.exists(dest_dir):
        os.makedirs(os.path.dirname(dest_dir), exist_ok=True)
        os.replace(src_dir, dest_dir)
        return "moved"
    # merge contents
    for entry in os.listdir(src_dir):
        s = os.path.join(src_dir, entry)
        d = os.path.join(dest_dir, entry)
        # "profiles" is the old name for "personalities"; both are merged per-user
        if entry in ("personalities", "profiles") and os.path.isdir(s):
            os.makedirs(d, exist_ok=True)
            for user in os.listdir(s):
                us, ud = os.path.join(s, user), os.path.join(d, user)
                if not os.path.exists(ud):
                    os.replace(us, ud)
                elif os.path.isfile(us) and os.path.isfile(ud) and filecmp.cmp(us, ud, shallow=False):
                    os.remove(us)
                elif os.path.isfile(us):
                    park = ud + ".root-bak"
                    os.replace(us, park)
                    conflicts.append(f"{name}/{entry}/{user}: kept score/; root → {os.path.basename(park)}")
            try:
                os.rmdir(s)
            except OSError:
                pass
            continue
        if not os.path.exists(d):
            os.replace(s, d)
        elif os.path.isfile(s) and os.path.isfile(d) and filecmp.cmp(s, d, shallow=False):
            os.remove(s)
        elif os.path.isfile(s):
            park = d + ".root-bak"
            os.replace(s, park)
            conflicts.append(f"{name}/{entry}: kept score/; root → {os.path.basename(park)}")
    try:
        os.rmdir(src_dir)
    except OSError:
        pass
    return "merged"


def run(root):
    """Migrate HUB_ROOT songs into score/ and mp3s into audio/. Returns a report dict."""
    root = os.path.abspath(root)
    report = {"moved_scores": 0, "moved_mp3s": 0, "moved_version_dirs": 0, "conflicts": []}
    if not os.path.isdir(root):
        return report

    score = os.path.join(root, SCORE_DIR)
    audio = os.path.join(root, AUDIO_DIR)
    os.makedirs(score, exist_ok=True)
    os.makedirs(audio, exist_ok=True)
    conflicts = report["conflicts"]

    for name in sorted(os.listdir(root)):
        if name in (SCORE_DIR, AUDIO_DIR, VDIR) or name.startswith("."):
            continue
        src = os.path.join(root, name)
        if not os.path.isfile(src):
            continue
        if name.endswith(".score"):
            result = _move_file(src, os.path.join(score, name), conflicts, name)
            if result in ("moved", "conflict"):
                report["moved_scores"] += 1
        elif name.lower().endswith(".mp3"):
            result = _move_file(src, os.path.join(audio, name), conflicts, name)
            if result in ("moved", "conflict"):
                report["moved_mp3s"] += 1

    # Sibling mp3s that already lived under score/ move into audio/.
    if os.path.isdir(score):
        for name in sorted(os.listdir(score)):
            if not name.lower().endswith(".mp3"):
                continue
            src = os.path.join(score, name)
            if not os.path.isfile(src):
                continue
            result = _move_file(src, os.path.join(audio, name), conflicts, name)
            if result in ("moved", "conflict"):
                report["moved_mp3s"] += 1

    root_versions = os.path.join(root, VDIR)
    if os.path.isdir(root_versions):
        dest_versions = os.path.join(score, VDIR)
        os.makedirs(dest_versions, exist_ok=True)
        for name in sorted(os.listdir(root_versions)):
            src = os.path.join(root_versions, name)
            if not os.path.isdir(src):
                continue
            result = _merge_version_dir(src, os.path.join(dest_versions, name), conflicts, name)
            if result in ("moved", "merged"):
                report["moved_version_dirs"] += 1
        try:
            os.rmdir(root_versions)
        except OSError:
            pass

    return report
