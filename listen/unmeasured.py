#!/usr/bin/env python3
"""Fields that were attempted and could not be measured, with the numbers.

    python3 listen/unmeasured.py [slug ...] [--write]

A null here is not a gap somebody forgot to fill. It is the result, and it costs
the map coverage in the scorer, which is the correct price. What makes it worth
writing down rather than leaving absent is the evidence: which instruments were
tried, what each one measured, and why the number it produced is not the thing
the field is named after. Anyone who wants to solve one of these starts from a
list of four approaches that do not work instead of trying them again.

Every entry carries `provenance: "unmeasured"`, which is not one of the three
tags a value can have -- because there is no value.
"""
import sys, os, json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapio import map_path

UNMEASURED = {
    "attack": {
        "value": None,
        "wanted": "per bar: is this bar percussive and hitty, or smooth and sustained, so a "
                  "reader can choose between stabbing and flowing without inferring it from "
                  "loudness",
        "provenance": "unmeasured",
        "why_null": "two candidate writers and three candidate checks were built and no pair "
                    "of them agrees. A number written here would be one nobody could "
                    "corroborate, which is the one thing this file is not allowed to contain.",
        "what_was_tried": [
            {"instrument": "envelope flux ratio -- the share of a bar's energy that arrives "
                           "as a positive jump in the broadband envelope",
             "role": "writer",
             "result": "has range, but is uncorrelated with the HPSS percussive share "
                       "(r = -0.25 to +0.36 across the five songs), so the two disagree "
                       "about which bars are percussive"},
            {"instrument": "harmonic-percussive source separation (librosa, margin 2.0), "
                           "percussive share of bar energy",
             "role": "writer",
             "result": "not a loudness proxy, which is the right property (r with bar "
                       "loudness -0.35 to +0.28), but almost no range on these masters: "
                       "0.00-0.05 on mizhiyoram and 0.00-0.31 on levels. A track with an "
                       "obvious drum pattern reading 5% percussive is the measurement "
                       "failing, not the track"},
            {"instrument": "phase deviation of complex one-pole resonators at six octaves",
             "role": "check",
             "result": "measures signal-to-noise, not transients: correlation with envelope "
                       "flux came out -0.38, -0.42, +0.40 on three songs. Sign not even "
                       "stable"},
            {"instrument": "Bello phase deviation on a proper 256-point STFT, 24 sampled "
                           "bars per song",
             "role": "check",
             "result": "sign still unstable across songs: +0.51, -0.53, +0.17, +0.03, +0.26. "
                       "Phase deviation rises for transients AND for broadband noise, and "
                       "falls for steady tones however loud, so it cannot separate a "
                       "percussive bar from a noisy one"},
            {"instrument": "waveform autocorrelation over 60-800 Hz lags (tonalness)",
             "role": "check",
             "result": "consistent in sign at last but the WRONG sign -- percussive bars "
                       "should be less periodic, and correlation with flux came out "
                       "+0.23, +0.45, +0.25, +0.15, -0.07. Dominated by density"},
        ],
        "the_likely_cause": "synth/out is a mono 32 kHz downmix of a heavily limited "
                            "commercial master for four of the five songs. Limiting flattens "
                            "exactly the crest-factor difference between a hit and a pad, "
                            "which is the property this field is named after. Measuring it "
                            "may need a source that has not been through that.",
        "what_would_settle_it": "a recording with an unlimited transient response, or a "
                                "percussiveness estimate from the separated drum stem's own "
                                "envelope against the harmonic stems', which is not the same "
                                "as HPSS on the mix and was not tried",
    },
    "space": {
        "value": None,
        "wanted": "per section: direct-to-reverberant, so a reader can open the room up when "
                  "the record does",
        "provenance": "unmeasured",
        "why_null": "the ratio is measurable and does vary, but it is not a property of the "
                    "section, which is the rate the field is defined at. Two sections with "
                    "the same name disagree about as much as the whole song varies.",
        "what_was_tried": [
            {"instrument": "energy 100-250 ms after an isolated accent, over the energy at "
                           "+30 ms, median per section, using only accents with no other "
                           "accent inside the tail window",
             "role": "writer",
             "result": "varies 0.23 to 1.42 across sections within a song, and is NOT a "
                       "loudness artefact (r with local loudness -0.11 to -0.15). But the "
                       "same-named sections disagree: levels' three breaks read 0.71/0.69/"
                       "0.84 and its four drops 0.86/0.92/0.72/0.82, a same-name spread of "
                       "0.18 against a whole-song spread of 0.24. The Nights' four drops "
                       "read 0.50/0.95/0.45/0.71, nearly the full range of the song. On two "
                       "of five songs the same-name spread is 70%+ of the total"},
            {"instrument": "the same ratio read as reverberation directly",
             "role": "sanity check",
             "result": "gives the wrong answer where the answer is known: The Nights' intro "
                       "reads 0.97 and its drops 0.45-0.50, so the sparse reverberant intro "
                       "measures DRIER than the dense drops. What the window actually "
                       "contains in a drop is sidechain ducking -- which this file already "
                       "measures, as observations.pump -- and other instruments sustaining, "
                       "not a decay tail"},
        ],
        "the_likely_cause": "a post-onset window in dense music contains everything else that "
                            "is playing. Isolating a decay needs the gaps, and a limited "
                            "master has no gaps.",
        "what_would_settle_it": "measure the tail on the separated drum stem, where the gaps "
                                "between hits are real gaps, and correct for the ducking "
                                "depth already in observations.pump. Both are available and "
                                "neither was tried",
    },
}


def analyse(slug, write=False):
    p = map_path(slug)
    if not p:
        return {"error": "no map"}
    m = json.load(open(p))
    o = m.setdefault("observations", {})
    wrote = []
    for name, body in UNMEASURED.items():
        if isinstance(o.get(name), dict) and o[name].get("provenance") not in (
                None, "unmeasured"):
            continue                      # somebody measured it; do not overwrite
        o[name] = body
        wrote.append(name)
    if write:
        json.dump(m, open(p, "w"), indent=1, ensure_ascii=False)
        open(p, "a").write("\n")
    return {"slug": slug, "fields": wrote, "wrote": write}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in args or ["levels", "starlight", "mizhiyoram", "dont-look-down", "the-nights"]:
        r = analyse(slug, write)
        print("  %-16s %s%s" % (slug, r.get("error") or "null with evidence: "
                                + ", ".join(r["fields"]), "  -> written" if write else ""))
