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
    def __init__(self, m, params=None):
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
        self.pump_depth = float(pump.get("depth") or 0.0)

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

        zoom = (1.0
                + p["breath"] * pump * (0.35 + 0.65 * e)
                + p["punch"] * acc * (0.3 + 0.7 * e)
                + p["drop_punch"] * drop
                + p["build_push"] * build
                + push)
        gain = 1.0 + p["flash"] * acc + p["drop_flash"] * drop
        # A shove on the hardest hits, so an accent is felt and not only seen.
        shove = p["shake"] * acc * acc * (0.3 + 0.7 * e)
        ang = 2.399963 * (int(t * 7.0) % 17)          # deterministic direction
        return {
            "zoom": zoom, "gain": gain,
            "dx": drift_x + shove * math.cos(ang),
            "dy": drift_y + shove * math.sin(ang),
            "energy": e, "pump": pump, "accent": acc, "drop": drop, "build": build,
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
}
