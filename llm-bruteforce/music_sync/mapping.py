"""Pure functions: musical features -> per-frame RGB for a single RGB PAR.

Two styles:
  render_pulse  brightness = loudness floor + beat flashes that decay;
                hue holds per bar, steps on downbeats, jumps palette per section
  render_bands  R/G/B = bass/mid/treble energy (classic reactive look)
"""
import numpy as np

GAMMA = 2.2
FLOOR_MAX = 0.6          # brightness floor at full loudness
FLASH_DECAY_BEATS = 0.5  # flash reaches 5 % after this many beats
ONSET_FLASH_SCALE = 0.7  # off-beat hits flash to at most this
FLASH_DESATURATE = 0.25  # flashes pop slightly toward white

# Hues in 0..1. Four per palette so a 4-bar phrase cycles once.
PALETTES = [
    [0.00, 0.08, 0.95, 0.04],   # warm: red, orange, pink, red-orange
    [0.60, 0.50, 0.75, 0.55],   # cool: blue, cyan, violet, azure
    [0.33, 0.50, 0.16, 0.40],   # green, cyan, yellow, spring
    [0.83, 0.66, 0.95, 0.72],   # magenta, blue, pink, purple
]


def gamma_encode(x: np.ndarray, g: float = GAMMA) -> np.ndarray:
    x = np.clip(np.asarray(x, dtype=float), 0.0, 1.0)
    return np.round(x ** g * 255).astype(np.uint8)


def flash_envelope(n_frames: int, fps: int, event_times, strengths, decay_s: float) -> np.ndarray:
    """At each event jump to max(current, strength); otherwise decay so a full
    flash is at 5 % after decay_s seconds."""
    k = 0.05 ** (1.0 / max(decay_s * fps, 1e-9))
    hits = np.zeros(n_frames)
    for t, s in zip(event_times, strengths):
        i = int(round(t * fps))
        if 0 <= i < n_frames:
            hits[i] = max(hits[i], s)
    env = np.zeros(n_frames)
    cur = 0.0
    for i in range(n_frames):
        cur = max(cur * k, hits[i])
        env[i] = cur
    return env


def hue_track(n_frames: int, fps: int, downbeat_times, section_times,
              palettes=PALETTES, palette_indices=None) -> np.ndarray:
    """Hue per frame: one palette per section, stepping to the next palette
    colour on every downbeat inside that section."""
    t = np.arange(n_frames) / fps
    sections = np.asarray(sorted(section_times) or [0.0], dtype=float)
    downbeats = np.asarray(sorted(downbeat_times), dtype=float)
    sec_idx = np.maximum(np.searchsorted(sections, t, side="right") - 1, 0)
    hues = np.zeros(n_frames)
    for s in np.unique(sec_idx):
        pi = palette_indices[s] if palette_indices is not None else s
        pal = palettes[pi % len(palettes)]
        start = sections[s]
        mask = sec_idx == s
        # bars elapsed in this section = downbeats in [start, t]
        n_db = (np.searchsorted(downbeats, t[mask], side="right")
                - np.searchsorted(downbeats, start, side="left"))
        hues[mask] = np.asarray(pal)[(n_db - 1) % len(pal)]
    return hues


def hsv_to_rgb(h: np.ndarray, s: np.ndarray, v: np.ndarray) -> np.ndarray:
    h = np.mod(np.asarray(h, dtype=float), 1.0)
    s = np.clip(np.asarray(s, dtype=float), 0, 1)
    v = np.clip(np.asarray(v, dtype=float), 0, 1)
    i = np.floor(h * 6).astype(int) % 6
    f = h * 6 - np.floor(h * 6)
    p, q, tt = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    r = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [v, q, p, p, tt, v])
    g = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [tt, v, v, q, p, p])
    b = np.select([i == 0, i == 1, i == 2, i == 3, i == 4, i == 5], [p, p, tt, v, v, q])
    return np.stack([r, g, b], axis=-1)


def _beat_period(features) -> float:
    beats = np.asarray(features.get("beats", []), dtype=float)
    if len(beats) >= 2:
        return float(np.median(np.diff(beats)))
    tempo = features.get("tempo")
    return 60.0 / tempo if tempo else 0.5


def render_pulse(features: dict, fps: int) -> np.ndarray:
    loud = np.clip(np.asarray(features["loudness"], dtype=float), 0, 1)
    n = len(loud)
    period = _beat_period(features)
    decay = FLASH_DECAY_BEATS * period

    beats = list(features.get("beats", []))
    beat_flash = flash_envelope(n, fps, beats, [1.0] * len(beats), decay)
    onsets = features.get("onsets", [])
    onset_flash = flash_envelope(n, fps, [t for t, _ in onsets],
                                 [ONSET_FLASH_SCALE * s for _, s in onsets], decay * 0.6)
    flash = np.maximum(beat_flash, onset_flash)

    floor = FLOOR_MAX * loud
    brightness = floor + (1.0 - floor) * flash

    hue = hue_track(n, fps, features.get("downbeats", []), features.get("sections", [0.0]),
                    palette_indices=features.get("palette_indices"))
    sat = 1.0 - FLASH_DESATURATE * flash
    rgb = hsv_to_rgb(hue, sat, brightness)
    return gamma_encode(rgb)


def render_bands(features: dict, fps: int) -> np.ndarray:
    bands = np.clip(np.asarray(features["bands"], dtype=float), 0, 1)
    return gamma_encode(bands)
