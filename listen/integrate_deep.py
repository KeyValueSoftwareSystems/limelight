#!/usr/bin/env python3
import json, os, re, sys, glob

SCORE_DIR = os.path.join(os.path.dirname(__file__), "..", "hub", "files", "score")
MOSS_DIR = sys.argv[1] if len(sys.argv) > 1 else "/tmp/moss-v2"

SECTION_NORMALIZE = {
    "inst": "instrumental",
    "inst.": "instrumental",
    "pre chorus": "pre-chorus",
    "prechorus": "pre-chorus",
    "post chorus": "post-chorus",
    "postchorus": "post-chorus",
    "break": "breakdown",
    "build": "buildup",
    "build-up": "buildup",
}


def strip_numbering(label):
    return re.sub(r"\s*\d+$", "", label.strip().lower())


def normalize_section_label(label):
    label = strip_numbering(label)
    return SECTION_NORMALIZE.get(label, label)


def extract_json_array(raw):
    start = raw.find("[")
    if start < 0:
        return None
    text = raw[start:]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    depth = 0
    last_complete = -1
    in_string = False
    escape = False
    for i, ch in enumerate(text):
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                last_complete = i
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1

    if last_complete > 0:
        truncated = text[: last_complete + 1] + "]"
        try:
            return json.loads(truncated)
        except json.JSONDecodeError:
            pass

    objs = []
    for m in re.finditer(r"\{[^{}]*\}", raw):
        try:
            objs.append(json.loads(m.group()))
        except json.JSONDecodeError:
            pass
    return objs if objs else None


def clean_moments(moments):
    if not moments:
        return []

    seen = set()
    cleaned = []
    for m in moments:
        key = f"{m.get('time_s', 0):.1f}_{m.get('type', '')}"
        if key in seen:
            continue
        seen.add(key)
        if (
            m.get("description", "").count("continues to") > 0
            and m.get("intensity", 1) < 0.1
        ):
            continue
        cleaned.append(m)

    if len(cleaned) > 200:
        cleaned = [
            m
            for m in cleaned
            if m.get("intensity", 0) >= 0.1
            or m.get("type") in ("drop", "climax", "hook")
        ]

    return cleaned


def clean_sections(sections):
    if not sections:
        return []
    cleaned = []
    for s in sections:
        label = s.get("label") or s.get("type") or s.get("name", "unknown")
        label = normalize_section_label(label)
        start = s.get("start", s.get("start_s", s.get("time_s", 0)))
        end = s.get("end", s.get("end_s", 0))
        if isinstance(start, str):
            try:
                start = float(start)
            except:
                start = 0
        if isinstance(end, str):
            try:
                end = float(end)
            except:
                end = 0
        cleaned.append({"label": label, "start": float(start), "end": float(end)})
    return cleaned


def clean_emotion(emotion):
    if not emotion:
        return []
    cleaned = []
    for e in emotion:
        item = {
            "start": float(e.get("start", e.get("start_s", 0))),
            "end": float(e.get("end", e.get("end_s", 0))),
            "energy": float(e.get("energy", 5)),
            "valence": float(e.get("valence", 5)),
            "arousal": float(e.get("arousal", 5)),
            "emotion": str(e.get("emotion", "neutral")),
        }
        if "description" in e:
            item["description"] = str(e["description"])
        cleaned.append(item)
    return cleaned


def main():
    if not os.path.isdir(MOSS_DIR):
        print(f"MOSS v2 directory not found: {MOSS_DIR}")
        sys.exit(1)

    moss_files = glob.glob(os.path.join(MOSS_DIR, "*.json"))
    print(f"Found {len(moss_files)} MOSS v2 result files in {MOSS_DIR}")

    updated = 0
    for mf in sorted(moss_files):
        slug = os.path.splitext(os.path.basename(mf))[0]
        score_path = os.path.join(SCORE_DIR, f"{slug}.score")
        if not os.path.exists(score_path):
            print(f"  SKIP {slug}: no matching score file")
            continue

        with open(mf) as f:
            moss = json.load(f)
        with open(score_path) as f:
            score = json.load(f)

        changed = False

        if "sections" in moss or "sections_v2" in moss:
            score["sections"] = clean_sections(
                moss.get("sections") or moss["sections_v2"]
            )
            changed = True
            print(f"  {slug}: sections = {len(score['sections'])}")

        if "moments" in moss:
            score["moments"] = clean_moments(moss["moments"])
            changed = True
            print(f"  {slug}: moments = {len(score['moments'])}")
        elif "moments_raw" in moss:
            arr = extract_json_array(moss["moments_raw"])
            if arr:
                score["moments"] = clean_moments(arr)
                changed = True
                print(f"  {slug}: moments (from raw) = {len(score['moments'])}")
            else:
                print(f"  {slug}: moments_raw could not be parsed")

        if "emotion" in moss:
            score["emotion"] = clean_emotion(moss["emotion"])
            changed = True
            print(f"  {slug}: emotion = {len(score['emotion'])} segments")

        if changed:
            with open(score_path, "w") as f:
                json.dump(score, f, indent=2, ensure_ascii=False)
            updated += 1

    print(f"\nUpdated {updated}/{len(moss_files)} score files")


if __name__ == "__main__":
    main()
