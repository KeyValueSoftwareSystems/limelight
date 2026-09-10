# Transcripts

Model output, not audio, so it belongs in git: 500 bytes here saves a
35-minute CPU run and it is the provenance for a field in the map.

`mizhiyoram.moss-music-8b-instruct.txt` — MOSS-Music-8B-Instruct on the release
mix at 16 kHz mono, greedy, prompt "Transcribe the lyrics of this song. Put the
start time in seconds at the beginning of every line." Run on CPU with resident
weights capped at 13 GiB and the rest offloaded to disk, because 18.1 GB of
bf16 does not fit 16 GB of free RAM. 2074 seconds for 496 characters.

Why this model is here at all: whisper-small cannot read this recording. It
returned zero segments from the separated vocal with the language auto-detected
AND with Malayalam given explicitly, and on the raw mix it returned invented
text mixing Korean and Chinese glyphs into English. That was a tooling gap, not
a property of the record.

Why only lyrics: MOSS-Music also does chord, key and tempo reasoning and
structural analysis. None of that is taken. Every check in listen/mapeval.py
rests on the two sides having no common ancestor -- meter is ChordMini against
MERT, identity is MERT against ChordMini against drum onsets, hook is a speech
model against a pitch tracker. One model supplying two sides of a check is that
model grading itself.

An independent reason to believe the timestamps: this transcript puts the first
sung word at 23.02 s, and basic-pitch -- a different model, on a separated stem
-- puts mizhiyoram's first vocal note at 23.49 s. Nothing in this file was told
that.

Convert to the shape listen/hook.py reads:

    python3 listen/lyrics_moss.py mizhiyoram \
        listen/transcripts/mizhiyoram.moss-music-8b-instruct.txt --write
