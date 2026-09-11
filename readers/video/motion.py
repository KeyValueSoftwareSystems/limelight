#!/usr/bin/env python3
"""What the picture is doing at instant t. A function of the map, and of t.

This is the video lane's version of the rule the whole repo is built on:

    frame = f(map, layout, recipe, t)

The lighting reader obeys it already -- "not 'on the beat, start a fade' but
'brightness = f(position in the beat)'". The video reader did not. It decided
WHEN to cut and then handed ffmpeg a flat list of clips, which is why three
edits of it were rejected as "clips pieced together": between cuts, nothing
happened at all.

So the same rule, applied to picture: scale = f(position in the beat).

WHY THIS SHOULD BEAT A PERSON, which is the actual bar. It will not out-taste an
editor. What it can do is work at a density and precision nobody would pay for
by hand:

  - `observations.pump.shape` is 24 measured bins of THIS RECORD'S sidechain
    envelope -- the shape the mix itself breathes with. Driving zoom from it
    makes the image breathe on the same curve as the music, every beat, for the
    whole song. An editor approximates this with a couple of keyframes and an
    ease; here it is the measurement.
  - `accents` holds 3520 timed hits with per-stem attribution and strength.
    Nobody keyframes 3520 events. A machine can put a 90 ms impulse on every
    one that clears a threshold.
  - beats are placed to 7-17 ms, so a punch lands on the transient rather than
    near it.

Everything below is PURE: f(map, params, t). No state, no memory, no
accumulation between frames. Ask for t = 12.0 twice and get identical numbers,
which is what makes a render reproducible and a bug findable.
"""
import bisect, math


class Motion:
    def __init__(self, m, params=None, fx_rule=None):
        p = dict(DEFAULTS)
        p.update(params or {})
        self.p = p
        self.beats = m.get("beats") or []
        self.downs = m.get("downbeats") or self.beats
        obs = m.get("observations") or {}

        pump = obs.get("pump") or {}
        shape = pump.get("shape")
        # The measured envelope, normalised to 0-mean so it modulates rather
        # than offsets. If the map has no pump, this is silent -- a flat curve
        # -- rather than an invented one.
        if isinstance(shape, list) and len(shape) >= 4:
            mean = sum(shape) / len(shape)
            rng = max(1e-6, max(shape) - min(shape))
            self.pump = [(v - mean) / rng for v in shape]
        else:
            self.pump = None
        # Scale the breathing by the MEASURED depth, against the deepest pump
        # this repo has measured (Levels, 0.147). listen/pump.py reports
        # present=False on Don't Look Down at 0.065, and without this the
        # normalised shape would drive full-amplitude breathing from a curve the
        # measurement says is not really there -- an effect asserting something
        # the map denies.
        self.pump_depth = float(pump.get("depth") or 0.0)
        self.pump_scale = min(1.0, self.pump_depth / 0.147) if self.pump else 0.0
        if pump.get("present") is False:
            self.pump_scale *= 0.5

        self.energy = m.get("energy") or []
        self.e_at = [e[0] if isinstance(e, list) else e["at"] for e in self.energy]
        self.e_v = [e[1] if isinstance(e, list) else e["value"] for e in self.energy]

        # Accents, thinned to the ones worth reacting to. 3520 events at full
        # density would be a continuous blur; the strongest per 16th is what a
        # person would feel as a hit.
        acc = (m.get("accents") or {}).get("events") or []
        keep = []
        for e in acc:
            if not isinstance(e, dict):
                continue
            s = e.get("strength")
            if s is None or s < p["accent_floor"]:
                continue
            t = e.get("at")
            if t is None:
                continue
            if keep and t - keep[-1][0] < p["accent_refractory"]:
                if s > keep[-1][1]:
                    keep[-1] = (t, s)
                continue
            keep.append((t, float(s)))
        self.acc_t = [k[0] for k in keep]
        self.acc_s = [k[1] for k in keep]
        smax = max(self.acc_s) if self.acc_s else 1.0
        self.acc_s = [s / smax for s in self.acc_s]

        self.moments = sorted(m.get("moments") or [], key=lambda x: x["at"])
        self.drops = [x["at"] for x in self.moments if x["kind"] in ("drop", "stop")]
        self.spans = m.get("spans") or []
        self.dur = (m.get("song") or {}).get("length") or 0.0
        self.fx_rule = fx_rule or {}
        self._plan_effects()

    # ---- primitives -------------------------------------------------------
    def beat_phase(self, t):
        """Where t sits inside its beat, 0 to 1. None if there is no grid."""
        b = self.beats
        if len(b) < 2:
            return None
        i = bisect.bisect_right(b, t) - 1
        if i < 0 or i + 1 >= len(b):
            return None
        span = b[i + 1] - b[i]
        return (t - b[i]) / span if span > 1e-9 else None

    def pump_at(self, t):
        """The record's own sidechain envelope, sampled at this instant."""
        if not self.pump:
            return 0.0
        ph = self.beat_phase(t)
        if ph is None:
            return 0.0
        x = ph * len(self.pump)
        i = int(x) % len(self.pump)
        j = (i + 1) % len(self.pump)
        f = x - int(x)
        return self.pump[i] * (1 - f) + self.pump[j] * f

    def energy_at(self, t):
        if not self.e_at:
            return 0.5
        i = bisect.bisect_right(self.e_at, t) - 1
        i = max(0, min(i, len(self.e_v) - 1))
        return self.e_v[i]

    def accent_at(self, t):
        """A short impulse from any recent accent. Attack is instant, decay
        exponential, because that is what a hit looks like."""
        if not self.acc_t:
            return 0.0
        tau = self.p["accent_decay"]
        i = bisect.bisect_right(self.acc_t, t) - 1
        out = 0.0
        for k in (i, i - 1):
            if 0 <= k < len(self.acc_t):
                dt = t - self.acc_t[k]
                if 0 <= dt < tau * 4:
                    out = max(out, self.acc_s[k] * math.exp(-dt / tau))
        return out

    def drop_at(self, t):
        """The same shape, much longer, for the moments that matter."""
        if not self.drops:
            return 0.0
        tau = self.p["drop_decay"]
        i = bisect.bisect_right(self.drops, t) - 1
        if i < 0:
            return 0.0
        dt = t - self.drops[i]
        return math.exp(-dt / tau) if 0 <= dt < tau * 5 else 0.0

    def build_at(self, t):
        """0 to 1 across a build span, so the picture can tighten into a drop."""
        for s in self.spans:
            if s.get("kind") != "build":
                continue
            a, b = s.get("from"), s.get("to")
            if a is None or b is None or b <= a:
                continue
            if a <= t < b:
                return (t - a) / (b - a)
        return 0.0

    # ---- which effect, and whether any ------------------------------------
    #
    # ONE effect fired on every accent, everywhere, for the whole video. A
    # person watching it put it exactly: "boom boom effects for no reason
    # throughout, and only that effect". Both halves of that are faults.
    #
    # ONLY THAT EFFECT: the map names six kinds of moment -- build, drop, stop,
    # quiet, spotlight, return -- and five of them were being answered with the
    # same zoom punch. A stop is not a drop. The interface tier already carries
    # the distinction; nothing was reading it.
    #
    # FOR NO REASON: there was no budget. Cuts have one -- a fixed amount of
    # attention, spent on the strongest moments, with the rest declined -- and
    # effects had none, so every accent got one and none of them meant anything.
    # Effects are budgeted the same way now, and the budget is smaller than the
    # number of candidates ON PURPOSE. What is declined is what makes the rest
    # land.
    #
    # And `still` windows: stretches where the answer is nothing at all.

    KIND_EFFECT = {
        "drop":      ("punch", 1.00),   # scale slam + flash
        "stop":      ("freeze", 0.95),  # the picture stops with the music
        "build":     ("trails", 0.70),  # echo that tightens toward the top
        "return":    ("whip", 0.65),    # a fast directional throw
        "spotlight": ("bloom", 0.60),   # light blooms, nothing moves
        "quiet":     ("still", 0.00),   # deliberately nothing
    }

    # A second response, used where the FIRST one has already been spent on the
    # same kind. Product films punctuate with black -- a few frames of nothing
    # between two ideas -- and repeating the identical slam on every drop is how
    # "only that effect" happened in the first place.
    KIND_ALT = {"drop": "blink", "stop": "blink", "return": "bloom"}

    def _plan_effects(self):
        """Which moments get an effect, decided once, from the map alone.

        Ranked by kind weight times measured salience, then cut to the budget.
        Everything below the line is left alone, and `quiet` is never given an
        effect at all -- its entry exists so that a quiet moment SUPPRESSES the
        ambient motion rather than merely failing to add to it.
        """
        p = self.p
        dur = self.dur or 1.0
        allowed = max(0, int(round(p["effects_per_minute"] * dur / 60.0)))
        cands = []
        for m in self.moments:
            kind = m.get("kind")
            eff, w = self.KIND_EFFECT.get(kind, (None, 0))
            if not eff:
                continue
            size = m.get("size")
            strength = w * (0.6 + 0.4 * (size if isinstance(size, (int, float)) else 0.6))
            cands.append({"at": m["at"], "kind": kind, "effect": eff,
                          "strength": strength})
        cands.sort(key=lambda c: -c["strength"])
        # What this footage can carry, if anything has measured it. An effect
        # that changes the picture by 0.0 out of 255 is not restraint and one
        # that changes it by 137 is not punctuation; neither was chosen.
        forbid = set(self.fx_rule.get("forbid") or [])
        allow = set(self.fx_rule.get("allow") or [])
        if forbid or allow:
            for c in cands:
                if c["effect"] in forbid or (allow and c["effect"] not in allow):
                    alt = [a for a in (allow or []) if a not in forbid]
                    c["effect"] = alt[0] if alt else "still"
                    c["swapped_for_this_footage"] = True
        granted = [c for c in cands if c["effect"] != "still"][:allowed]
        # Alternate within a kind, so three drops are not three identical slams.
        seen = {}
        for c in granted:
            n = seen.get(c["kind"], 0)
            seen[c["kind"]] = n + 1
            if n % 2 == 1 and c["kind"] in self.KIND_ALT:
                alt = self.KIND_ALT[c["kind"]]
                if alt not in (self.fx_rule.get("forbid") or []) and \
                   (not self.fx_rule.get("allow") or alt in self.fx_rule["allow"]):
                    c["effect"] = alt
        granted.sort(key=lambda c: c["at"])
        self.effects = granted
        self.quiets = [m["at"] for m in self.moments if m.get("kind") == "quiet"]
        self.declined = len(cands) - len(granted)

    def effect_at(self, t):
        """The active effect and how far through it we are, or None.

        None is a real answer and the common one: most instants have no effect,
        which is the point.
        """
        best = None
        for e in getattr(self, "effects", []):
            span = self.p["effect_len"].get(e["effect"], 0.5)
            dt = t - e["at"]
            if 0 <= dt < span:
                k = dt / span
                if best is None or k < best["through"]:
                    best = {"effect": e["effect"], "through": k,
                            "strength": e["strength"], "at": e["at"],
                            "kind": e["kind"]}
        return best

    def stillness(self, t):
        """1 where the picture should be left alone, 0 where it is free.

        Rises inside a `quiet` moment's shadow and just before a granted effect,
        so that the loud thing arrives out of calm instead of out of more noise.
        """
        p = self.p
        s = 0.0
        for q in getattr(self, "quiets", []):
            dt = t - q
            if 0 <= dt < p["quiet_len"]:
                s = max(s, 1.0 - dt / p["quiet_len"])
        for e in getattr(self, "effects", []):
            lead = p["hush_before"]
            dt = e["at"] - t
            if 0 < dt <= lead:
                s = max(s, 0.85 * (1.0 - dt / lead))
        return s

    # ---- what the renderer asks for ---------------------------------------
    def at(self, t, shot=None):
        """Every per-frame value, as one dict. Pure in (map, params, t, shot).

        `shot` is {i, start, end} for the shot on screen, used only for motion
        that belongs to a shot rather than to the song -- the slow push across a
        take. It carries no state; the push is a function of where t sits inside
        the shot, so any frame can still be rendered on its own.
        """
        p = self.p
        e = self.energy_at(t)
        pump = self.pump_at(t)
        acc = self.accent_at(t)
        drop = self.drop_at(t)
        build = self.build_at(t)

        # A slow push or pull across each take. Direction alternates by shot
        # index, deterministically, so consecutive shots do not all drift the
        # same way -- a page of shots all pushing in reads as a screensaver.
        push = 0.0
        drift_x = drift_y = 0.0
        if shot and shot.get("end", 0) > shot.get("start", 0):
            k = (t - shot["start"]) / (shot["end"] - shot["start"])
            k = max(0.0, min(1.0, k))
            sgn = 1.0 if (shot.get("i", 0) % 2 == 0) else -1.0
            push = p["shot_push"] * sgn * (k - 0.5) * 2.0
            # A little lateral drift, perpendicular to nothing in particular.
            # It is the difference between a still frame and a held one.
            drift_x = p["shot_drift"] * math.sin(2 * math.pi * (0.12 * k + 0.25 * (shot.get("i", 0) % 4)))
            drift_y = p["shot_drift"] * 0.5 * math.cos(2 * math.pi * (0.09 * k))

        # The same formula everywhere is why the effects read as "the same
        # throughout". A build should be doing LESS at its start than at its
        # end, and the section after a drop should be spending what the build
        # saved. `arc` is that envelope: it rises across a build span, peaks
        # through a drop's decay, and otherwise sits at a floor.
        arc = p["arc_floor"] + (1 - p["arc_floor"]) * max(build * build, drop)
        # Stillness overrides the arc. Without this the "ambient" motion never
        # reaches zero and there is no such thing as a calm passage.
        hush = self.stillness(t)
        arc *= (1.0 - hush)
        zoom = (1.0
                + p["breath"] * self.pump_scale * pump * (0.35 + 0.65 * e) * arc
                + p["punch"] * acc * (0.3 + 0.7 * e) * arc
                + p["drop_punch"] * drop
                + p["build_push"] * build
                + push * (0.6 + 0.4 * arc))
        gain = 1.0 + p["flash"] * acc * arc + p["drop_flash"] * drop
        # A shove on the hardest hits, so an accent is felt and not only seen.
        shove = p["shake"] * acc * acc * (0.3 + 0.7 * e) * arc
        ang = 2.399963 * (int(t * 7.0) % 17)          # deterministic direction
        return {
            "zoom": zoom, "gain": gain,
            "dx": drift_x + shove * math.cos(ang),
            "dy": drift_y + shove * math.sin(ang),
            "energy": e, "pump": pump, "accent": acc, "drop": drop,
            "build": build, "arc": arc,
        }


# The first pass used roughly half of these and the whole zoom range came out
# 0.984 to 1.088 -- so small that two frames either side of a drop were
# indistinguishable in a still. Motion that cannot be seen is motion that was
# not applied. These are the values at which the map's own measurements are
# actually legible on screen.
DEFAULTS = {
    "breath": 0.075,        # how much the image moves with the sidechain
    "punch": 0.090,         # scale kick on an accent
    "flash": 0.16,          # brightness kick on an accent
    "drop_punch": 0.26,     # scale kick on a drop or stop
    "drop_flash": 0.30,
    "build_push": 0.09,     # slow tightening across a build span
    "shot_push": 0.10,      # slow push across each take, direction alternating
    "shot_drift": 0.012,    # lateral drift, as a fraction of frame width
    "shake": 0.010,         # shove on the hardest accents
    "accent_floor": 0.35,   # below this an accent is not reacted to
    "accent_refractory": 0.09,
    "accent_decay": 0.085,  # seconds
    "drop_decay": 0.40,
    # How much of the motion is present OUTSIDE a build or a drop. Below 1 the
    # picture is calmer in the ordinary bars, which is what makes the loud ones
    # feel loud. At 1.0 every second gets the same treatment and the result
    # reads as one effect applied evenly, which is the note this was written to
    # answer.
    # Ambient motion outside a build or a drop. Lower than it was: the constant
    # low-level movement is what read as "boom boom throughout".
    "arc_floor": 0.22,

    # Effects are budgeted like cuts, and the budget is deliberately small.
    "effects_per_minute": 7.0,
    "hush_before": 1.6,        # seconds of calm bought before a granted effect
    "quiet_len": 3.0,          # how long a `quiet` moment keeps the picture still
    "effect_len": {            # how long each effect runs
        "punch": 0.55, "freeze": 0.42, "trails": 1.60,
        "whip": 0.34, "bloom": 1.20, "blink": 0.22,
    },
    # Per-effect strength, so a brief can turn any of them down or off.
    "fx_punch": 1.00, "fx_freeze": 1.00, "fx_trails": 1.00,
    "fx_whip": 1.00, "fx_bloom": 1.00, "fx_rgb": 0.55, "fx_blink": 1.00,
}
