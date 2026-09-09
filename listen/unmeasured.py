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
    "percentile": {
        "value": None,
        "wanted": "where this song sits against other songs -- busier than 80% of them, "
                  "slower than 60% -- so a reader can tell a restrained record from a "
                  "relentless one without being told what normal is",
        "provenance": "unmeasured",
        "why_null": "the corpus is five songs. A percentile over five is quantised to "
                    "20-point steps before anything else goes wrong, and the check the brief "
                    "asked for -- rank stability across a corpus split -- fails outright.",
        "what_was_tried": [
            {"instrument": "percentile of five per-song scalars (bpm, accents per second, "
                           "mean energy, energy range, drops per minute) over the five-song "
                           "corpus, with the corpus resampled 200 times",
             "role": "writer and check together",
             "result": "every one of the five features moves 40 percentile points between "
                       "the 10th and 90th resample. A number that swings 40 points is not a "
                       "fact about the song, it is a fact about which four songs happened to "
                       "be in the corpus"},
        ],
        "the_likely_cause": "five songs, four of them 126-128 bpm dance records and one lofi "
                            "cover at 84. There is no corpus here to be relative to.",
        "what_would_settle_it": "more songs, and they have to be REAL RECORDINGS. The "
                                "resample swing falls roughly as one over the square root of "
                                "the corpus size, so getting from 40 points to 10 needs "
                                "something like 80 songs -- an estimate from that scaling, "
                                "not a measurement. The field is cheap to fill the moment a "
                                "corpus exists: the writer is five lines and the check is the "
                                "bootstrap already written here.",
        "do_not_do_this": "there is a synthesis pipeline in this repository -- synth/"
                          "compose.py writes ten songs identically on every machine -- and "
                          "the blocker here is corpus size, so filling this from generated "
                          "music is the obvious shortcut. It is refused. A percentile over "
                          "synthetic songs describes the distribution of the GENERATOR, not "
                          "of music: it would say a record is busier than 80% of songs when "
                          "it means busier than 80% of the things compose.py happens to "
                          "write. It would look like progress and be the most misleading "
                          "number in the file, because nothing about its shape would reveal "
                          "where it came from. Synthetic truth can test what we can already "
                          "name; it cannot stand in for a population.",
    },
    "weight": {
        "value": None,
        "wanted": "how much this record MEANS to the people who will be in the room -- the "
                  "difference between the drop everybody has been waiting for and a drop in "
                  "a song nobody knows",
        "provenance": "unmeasured",
        "why_null": "still null, but the blocker moved. Last round two crowd sources could "
                    "not agree on which record they were describing. The reason was in this "
                    "file: song.title was a filename and song.artist was '?', so every lookup "
                    "had to guess. The record is now named, and song.mbid and song.isrc exist "
                    "and are null, waiting on one human confirmation.",
        "what_changed": "listen/identify.py writes title and artist with provenance STATED, "
                        "read off the release file, and proposes MusicBrainz candidates ranked "
                        "by how close their length is to the length measured here -- the one "
                        "piece of evidence this repository actually holds. It prints and does "
                        "not write. A machine match a human rubber-stamps is the same wrong "
                        "answer with an extra step, and title matching is precisely what "
                        "failed.",
        "what_was_tried": [
            {"instrument": "MusicBrainz recording search, artist and title",
             "role": "crowd source one",
             "result": "130 matching recordings for Avicii's Levels, 14 for Don't Look Down, "
                       "0 for Mizhiyoram, and two of five queries timed out. Hit count "
                       "measures how often a track has been re-released, which is not what "
                       "this field asks"},
            {"instrument": "Wikipedia REST summary, by title",
             "role": "crowd source two",
             "result": "resolved 'Levels' to a 29-character disambiguation stub called "
                       "'Level' and 'Don't Look Down' to an unrelated page. A source that "
                       "identifies the wrong entity is worse than none, because the number it "
                       "produces looks exactly like a real one"},
            {"instrument": "listen/identify.py --propose, run 9 September 2026",
             "role": "the unblock",
             "result": "MusicBrainz answered 503 on every attempt that day, so no candidate "
                       "list was produced. The tool is written and the query is right; the "
                       "service was down. Run it again when it is up"},
        ],
        "the_remaining_blocker": "one person confirming one identifier per song. Everything "
                                 "after that is arithmetic, and the cross-source check the "
                                 "brief asked for becomes possible because both sources are "
                                 "finally keyed on the same entity.",
        "and_a_caution": "this is the one field whose source is outside the recording. "
                         "Whatever fills it is a claim about a population, measured at a "
                         "moment, that changes without the song changing -- so it needs a "
                         "date attached in a way none of the other fields do.",
    },
    "idiom": {
        "value": None,
        "wanted": "which conventions this record is working inside, so a reader can know that "
                  "a bar of silence before a drop is a genre convention being honoured rather "
                  "than the song stopping",
        "provenance": "unmeasured",
        "why_null": "no check exists that is not circular. Every candidate compares the "
                    "record against a model or a corpus that would have to encode the same "
                    "conventions to judge them, and with five songs there is no corpus to "
                    "encode them from.",
        "what_was_tried": [
            {"instrument": "the MuLan mood embedding already in observations.mood",
             "role": "considered and refused",
             "result": "it produces genre-like labels, but grading them means comparing a "
                       "model's genre labels against a model's genre labels. That is the "
                       "circular verification this whole piece of work exists to remove, and "
                       "adding it back for a field nobody has asked a reader to use would be "
                       "the worst trade in the file"},
        ],
        "the_likely_cause": "an idiom is a fact about a body of music, and this repository has "
                            "five songs, four of which are the same idiom.",
        "what_would_settle_it": "a corpus with labelled idioms and a held-out split, which is "
                                "the same blocker as `percentile` and would be solved by the "
                                "same corpus",
    },
    "restraint": {
        "value": None,
        "provenance_allowed": ["stated"],
        "wanted": "where the record is deliberately holding back -- not quiet, HELD. A reader "
                  "that cannot tell the two apart spends everything in the first minute",
        "provenance": "unmeasured",
        "why_null": "the brief allows this field STATED provenance only, and nobody has "
                    "stated it. That is not a gap to be filled by a measurement; a "
                    "measurement here would be the wrong kind of answer and this field "
                    "refuses one by design.",
        "how_it_gets_filled": "a human listens and says so, through listen/corrections.py, "
                              "which is why that tool was built first. The entry carries who "
                              "said it and why, and provenance stays 'stated' -- it never "
                              "becomes 'measured' by being written down.",
        "what_was_tried": [
            {"instrument": "low energy with high harmonic activity -- quiet bars that are "
                           "still doing something",
             "role": "candidate writer, refused",
             "result": "not tried against the audio, and deliberately. It would produce a "
                       "number with provenance 'measured' for a field the brief says may only "
                       "be 'stated', and a measured-looking number is exactly what makes a "
                       "human judgment impossible to find later"},
        ],
        "what_would_settle_it": "one person, one pass through one song, and an entry in the "
                                "corrections log. It is the cheapest unsolved field here and "
                                "the only one that needs no code at all",
    },
    "latent": {
        "value": None,
        "empty": True,
        "wanted": "room for what a learned head finds that nobody has named yet",
        "provenance": "unmeasured",
        "why_null": "empty on purpose, and labelled empty on purpose. The brief says ship it "
                    "empty; the reason it is worth shipping empty is that an empty labelled "
                    "field tells a reader the slot exists and is unclaimed, where an absent "
                    "field tells it nothing. Anything put here now would be one of the "
                    "measurements already in this file wearing a name that promises more.",
        "what_was_tried": [
            {"instrument": "nothing",
             "role": "-",
             "result": "no attempt was made, which is the correct amount of attempt. There is "
                       "no head trained yet, and the vectors it would be trained from are in "
                       "the sidecar and already referenced"},
        ],
        "what_would_settle_it": "a trained head, and the one thing to get right when it "
                                "arrives is that whatever it emits goes here under a name "
                                "that does not claim to be a musical fact until somebody has "
                                "checked it against one",
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
