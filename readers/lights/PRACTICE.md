# What lighting designers actually do, and where my recipe disagreed with them

Researched rather than invented, then used as an audit. Three findings, and the first one is that
I had a principle backwards.

## 1. Saturation — I had it inverted

**Practice:** highly saturated colour is the default in a big room, *because* saturation cuts
through haze and reads at distance. It is also measurably more arousing — saturated light rates
higher on arousal than desaturated in controlled studies, and red measures higher cortical arousal
on EEG than blue or green.

**What I had:** `s = B.s * (1 - 0.30 * brightness)` — I was **desaturating the colour as the music
got brighter**, on an aesthetic hunch about "bright timbre whitens". That is exactly backwards for
a club: it washes out the moment the room should punch.

Now energy raises saturation and only the flash goes white. Honest caveat: measured RGB saturation
comes out flat at about 0.77 across the song rather than rising, because raising HSL lightness
offsets raising saturation. The fix removed the *desaturation*; it did not produce a rising trend.
Consistently saturated is what the practice asks for, so this is fine — but I am not going to
claim a trend the measurement does not show.

## 2. Darkness is a tool, and I was never using it

**Practice:** minimalist designs work through darkness, shadow and silhouette. Powerful effects do
not require lighting the whole stage; negative space is what heightens the moment after it. *Rock
concert lighting favours contrast over comfort.*

**What I had:** every section base sat above 0.05, so the room was always faintly on. There was no
genuine darkness anywhere except inside a `stop`, which is one moment Renjith may yet delete.

Breaks and quiets now go properly dark. Measured mean level across the 24 emitters:

```
intro    0.036      drop 1   0.353
break    0.055      drop 2   0.464
build    0.054      flash    0.494
outro    0.027
```

A ten-to-one range where there used to be about three-to-one. The drop lands because the bar
before it does not.

## 3. Blinders — the strongest gesture in the vocabulary, and nothing in the rig could make it

**Practice:** blinders are lamps *pointed at the audience*. Pointing light at the crowd rather
than the stage is the single biggest move in concert lighting, and it is used sparingly — a
blinder that is on often is just a lamp.

Every fixture in my 23-fixture rig aimed at the floor or the back wall. **Nothing faced the
crowd.** Two blinders added at `y = 2.55, z = 2.60` with `aims_at: "audience"`, and they fire in
exactly two windows: one bar at a drop, and a swell across the last two bars of a build.

```
t=63.62  build   0.00
t=64.00  flash   0.97 @ 0.7 Hz
t=64.38  drop    0.93 @ 3.8 Hz
t=64.76  drop    0.64
t=65.14  drop    0.21
t=65.53  drop    0.00     <- one bar, then gone
```

## Where the recipe already agreed with practice

Worth recording, because two of these were luck rather than judgement:

- **Amber for the verses.** Practice puts amber on acoustic sets and ballads — warmth, intimacy,
  candlelight. The Nights' verses *are* acoustic guitar, and my verse palette was already amber.
- **Blue for the breaks.** Practice uses blue and teal to control pacing and slow the mood between
  peaks. That is what the break palette does.
- **Timecode.** *"For events demanding precise timing, such as EDM, timecode offers seamless
  synchronisation."* The map is timecode with meaning attached, so this project is aligned with
  professional practice by construction rather than by choice.

## Still missing from the vocabulary

- **A hard chase** — discrete step from fixture to fixture. I only have continuous travelling
  waves, which read as motion rather than as rhythm.
- **Ballyhoo, named and guaranteed.** The figure-of-eight exists in the head paths at high energy
  but is a side effect of the shape morph rather than a look I can ask for.
- **RKO** — the random searchlight sweep.
- **Gobos and prisms**, which are texture rather than colour and have no representation in `frame`
  at all.

Sources: [concert lighting design](https://gearsupply.com/blog/lighting-design-for-concerts) ·
[EDM beam lighting](https://www.djclublight.com/edm-stage-lighting-design-how-to-ignite-the-crowd-with-professional-beam-lights/) ·
[lighting with less](https://chauvetprofessional.com/news/pierre-claude-lighting-with-less/) ·
[Theatrecrafts glossary](https://theatrecrafts.com/pages/home/topics/lighting/glossary/) ·
[ballyhoo](https://plsn.com/articles/feeding-the-machines/ballyhoo-go/) ·
[colour and emotion, Wilms & Oberfeld 2018](https://www.staff.uni-mainz.de/oberfeld/downloads/Wilms-Oberfeld2018_Article_ColorAndEmotionEffectsOfHueSat.pdf) ·
[emotional response to coloured lighting](https://www.sciencedirect.com/science/article/abs/pii/S0360132325009163)
