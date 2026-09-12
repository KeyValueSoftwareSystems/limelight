#!/usr/bin/env python3
"""score_api: the artist's personality on a load -- pass through, filter, and missing-name errors."""
import score_api as S

PASS = FAIL = 0


def ok(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {label}")
    else:
        FAIL += 1
        print(f"FAIL  {label}" + (f" — {detail}" if detail else ""))


SAMPLE = {
    "score": "levels",
    "version": 3,
    "grid": {"bpm": 120, "first_beat_s": 0.5, "beats_per_bar": 4},
    "beats": {"list": [[1, 1], [1, 2]], "count": 2, "derived_from": "grid", "as": "[bar, beat]"},
    "personality": {"user": "sarath", "colours": [{"name": "magenta", "hex": "#ff00ff"}]},
}


def test_format_carries_personality():
    out = S.format_v1(SAMPLE)
    ok("format_v1 keeps the personality", out.get("personality", {}).get("user") == "sarath")
    ok("and sends the old key beside it", out.get("profile", {}).get("user") == "sarath")
    old = S.format_v1({"grid": SAMPLE["grid"],
                       "profile": {"user": "sarath", "colours": []}})
    ok("a score saved under the old key is read", old.get("personality", {}).get("user") == "sarath")
    plain = S.format_v1({k: v for k, v in SAMPLE.items() if k != "personality"})
    ok("omitted when absent", "personality" not in plain and "profile" not in plain)


def test_filter_keeps_personality_always():
    formatted = S.format_v1(SAMPLE)
    formatted["window"] = "whole song"
    out = S.filter_response(formatted, fields=["beats"], known=S.KNOWN)
    ok("the personality survives a narrow fields list",
       "personality" in out and "beats" in out and "grid" in out)
    ok("unasked energy is dropped", "energy" not in out)


def test_handle_passes_personality_to_fetch():
    seen = {}

    def fetch(name, person=None):
        seen["name"], seen["personality"] = name, person
        return dict(SAMPLE)

    r = S.handle({"score": "levels", "personality": "sarath", "fields": ["beats"]}, fetch)
    ok("fetch receives the name", seen == {"name": "levels", "personality": "sarath"})
    ok("response carries it", r["personality"]["user"] == "sarath")
    S.handle({"score": "levels", "profile": "sarath", "fields": ["beats"]}, fetch)
    ok("the old request key still reaches fetch", seen["personality"] == "sarath")

    S.handle({"score": "levels"}, fetch)
    ok("without one, fetch gets None", seen["personality"] is None)


def test_handle_rejects_a_bad_name():
    def fetch(name, person=None):
        return dict(SAMPLE)

    try:
        S.handle({"score": "levels", "personality": ""}, fetch)
        ok("an empty name is refused", False)
    except ValueError as e:
        ok("an empty name is refused", "personality" in str(e))

    try:
        S.handle({"score": "levels", "personality": 3}, fetch)
        ok("a non-string name is refused", False)
    except ValueError as e:
        ok("a non-string name is refused", "personality" in str(e))


def test_handle_surfaces_a_missing_one():
    def fetch(name, person=None):
        raise ValueError(f"no personality {person} for {name}.score\npersonalities: alnas, sarath")

    try:
        S.handle({"score": "levels", "personality": "nobody"}, fetch)
        ok("a missing one raises", False)
    except ValueError as e:
        t = str(e)
        ok("a missing one raises with the hub's own text",
           "no personality nobody" in t and "sarath" in t, t)


if __name__ == "__main__":
    test_format_carries_personality()
    test_filter_keeps_personality_always()
    test_handle_passes_personality_to_fetch()
    test_handle_rejects_a_bad_name()
    test_handle_surfaces_a_missing_one()
    print(f"{PASS} passed, {FAIL} failed")
    raise SystemExit(1 if FAIL else 0)
