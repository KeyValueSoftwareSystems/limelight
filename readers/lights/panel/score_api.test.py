#!/usr/bin/env python3
"""score_api: profile on /api/load — pass through, filter, and missing-profile errors."""
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
    "profile": {"user": "muzammil", "colours": [{"name": "red", "hex": "#ff0000"}]},
}


def test_format_carries_profile():
    out = S.format_v1(SAMPLE)
    ok("format_v1 keeps profile", out.get("profile", {}).get("user") == "muzammil")
    plain = S.format_v1({k: v for k, v in SAMPLE.items() if k != "profile"})
    ok("format_v1 omits profile when absent", "profile" not in plain)


def test_filter_keeps_profile_always():
    formatted = S.format_v1(SAMPLE)
    formatted["window"] = "whole song"
    out = S.filter_response(formatted, fields=["beats"], known=S.KNOWN)
    ok("profile survives a narrow fields list", "profile" in out and "beats" in out and "grid" in out)
    ok("unasked energy is dropped", "energy" not in out)


def test_handle_passes_profile_to_fetch():
    seen = {}

    def fetch(name, profile=None):
        seen["name"], seen["profile"] = name, profile
        return dict(SAMPLE)

    r = S.handle({"score": "levels", "profile": "muzammil", "fields": ["beats"]}, fetch)
    ok("fetch receives the profile name", seen == {"name": "levels", "profile": "muzammil"})
    ok("response carries the embedded profile", r["profile"]["user"] == "muzammil")

    S.handle({"score": "levels"}, fetch)
    ok("without profile, fetch gets None", seen["profile"] is None)


def test_handle_rejects_bad_profile():
    def fetch(name, profile=None):
        return dict(SAMPLE)

    try:
        S.handle({"score": "levels", "profile": ""}, fetch)
        ok("empty profile refused", False)
    except ValueError as e:
        ok("empty profile refused", "profile" in str(e))

    try:
        S.handle({"score": "levels", "profile": 3}, fetch)
        ok("non-string profile refused", False)
    except ValueError as e:
        ok("non-string profile refused", "profile" in str(e))


def test_handle_surfaces_missing_profile():
    def fetch(name, profile=None):
        raise ValueError(f"no profile {profile} for {name}.score\nprofiles: alnas, muzammil")

    try:
        S.handle({"score": "levels", "profile": "nobody"}, fetch)
        ok("missing profile raises", False)
    except ValueError as e:
        t = str(e)
        ok("missing profile raises with hub text",
           "no profile nobody" in t and "muzammil" in t, t)


if __name__ == "__main__":
    test_format_carries_profile()
    test_filter_keeps_profile_always()
    test_handle_passes_profile_to_fetch()
    test_handle_rejects_bad_profile()
    test_handle_surfaces_missing_profile()
    print(f"{PASS} passed, {FAIL} failed")
    raise SystemExit(1 if FAIL else 0)
