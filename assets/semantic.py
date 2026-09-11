#!/usr/bin/env python3
"""What each shot is OF, and which moods it looks like. CLIP, one frame per shot.

    work/audio/bin/python assets/semantic.py --set earth
    work/audio/bin/python assets/semantic.py --set earth --check

WHY. Three clip sets in this repo were curated by a person looking at a contact
sheet, and every one of those files says `how: curated` because the measurements
could not do it. brightness, contrast, saturation, motion and a 36-number look
vector separate bright from dark and still from moving, and none of them
separate a coastline from a car park. A clustering built on them picked "dark
things": a tape deck, three star fields and a train.

THE BRIDGE, stated precisely, because I described it loosely first and the loose
version is wrong. `observations.mood` comes from MuQ-MuLan, a joint music/text
model, scored against a fixed vocabulary -- euphoric, dark, sad, tender,
driving, calm, warm, cold, triumphant, tense. CLIP is a joint image/text model.
These are NOT the same embedding space and nothing here pretends they are: a
MuLan vector and a CLIP vector are not comparable. What they share is the
WORDS. So the path is

    music -> mood word   (MuLan, already in the map)
    mood word -> image   (CLIP, here)

and the join happens in English, which is a weaker claim than a shared space and
is the true one. It inherits both models' ideas of what "tender" looks like, and
those need not agree.

WHAT IS MEASURED
  mood        cosine between the shot's frame and each mood word, softmaxed
              across the vocabulary so the numbers are a distribution over
              moods rather than an absolute score
  content     the same against a content vocabulary, used only by --check

WHAT IT IS NOT. One frame per shot, from the middle. A shot that changes subject
partway through is described by whichever half the middle lands in. It is not a
detector, it has no idea what is in focus, and CLIP's own biases -- it was
trained on web alt-text -- arrive intact.

--check is the part that decides whether to believe any of it: it prints the
top content word for every shot so a person can see whether CLIP recognises the
footage at all. If it cannot name a waterfall, its opinion about "euphoric" is
worth nothing.
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# The map's own mood vocabulary. Read from a map rather than retyped, so the two
# halves of the bridge cannot drift apart.
def mood_vocab(slug="dont-look-down"):
    p = os.path.join(ROOT, "synth", "maps", "amal", slug + ".map.json")
    m = json.load(open(p))
    terms = ((m.get("observations") or {}).get("mood") or {}).get("terms")
    return list(terms) if terms else []

# The vocabulary has to be able to say WHEN as well as WHAT.
#
# The first version held "a road" and nothing else, so a promo for a track
# called Riding At Night opened on a daytime road under blue sky: the word
# matched noon and midnight equally well and the selector had no way to prefer
# one. Time of day and light are half of what a shot looks like, and a brief
# that cannot ask for them cannot get them.
CONTENT = [
    # what
    "a waterfall", "an ocean wave", "a forest", "a mountain range",
    "a sandy beach", "a person dancing", "a face", "a river",
    "a field of grass", "an aerial view of a coastline", "a musical instrument",
    "a machine", "a nightclub crowd",
    # what, and when
    "a road at night with headlights", "a road in daylight",
    "a city street at night", "a city in daylight",
    "car tail lights on a dark highway", "driving at night through a tunnel",
    "a neon sign at night", "city lights seen from above at night",
    "a starry night sky", "a sunset sky", "a sunrise",
    "a dark room lit by one lamp", "a bright overcast sky",
    # product-film grammar: the things a camera ad is made of
    "a smartphone held in a hand", "a close-up of a camera lens",
    "hands typing on a keyboard", "a face lit by a screen",
    "out-of-focus bokeh lights", "a macro close-up of a surface",
    "smoke or mist in a dark room", "a reflection in glass",
    "a glowing screen in the dark", "a studio product shot on black",
    "someone taking a photograph",
]


def paths_for(setname):
    if setname in (None, "default"):
        return (os.path.join(HERE, "INDEX.json"),
                os.path.join(HERE, "SEMANTIC.json"))
    base = os.path.join(HERE, "stock", setname)
    return (os.path.join(base, "INDEX.json"), os.path.join(base, "SEMANTIC.json"))


def frame_at(src, t, out):
    subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", src,
                    "-frames:v", "1", "-vf", "scale=336:-1", "-q:v", "3",
                    out, "-y"], check=False)
    return os.path.exists(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", dest="setname", default="default")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--mood-from", default="dont-look-down")
    a = ap.parse_args()

    import torch
    from transformers import CLIPModel, CLIPProcessor
    from PIL import Image

    idx_p, out_p = paths_for(a.setname)
    index = json.load(open(idx_p))
    moods = mood_vocab(a.mood_from)
    if not moods:
        print("no mood vocabulary in the map -- nothing to bridge to", file=sys.stderr)
        return 2

    model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").eval()
    proc = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

    def embed_text(words):
        with torch.no_grad():
            t = proc(text=words, return_tensors="pt", padding=True)
            v = model.get_text_features(**t)
        return v / v.norm(dim=-1, keepdim=True)

    # A template, because CLIP was trained on captions and a bare adjective is
    # not a caption. "euphoric" alone scores nearly the same on everything.
    mood_vecs = embed_text([f"a {w} scene" for w in moods])
    content_vecs = embed_text(CONTENT)

    tmp = os.path.join(ROOT, "renders", "_sem.jpg")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    rows = []
    for c in index["clips"]:
        src = os.path.join(HERE, c["file"])
        for i, sh in enumerate(c.get("shots") or []):
            mid = (sh["start"] + sh["end"]) / 2
            if not frame_at(src, mid, tmp):
                continue
            with torch.no_grad():
                im = proc(images=Image.open(tmp).convert("RGB"), return_tensors="pt")
                v = model.get_image_features(**im)
            v = v / v.norm(dim=-1, keepdim=True)
            ms = (v @ mood_vecs.T).squeeze(0)
            cs = (v @ content_vecs.T).squeeze(0)
            rows.append({
                "clip_id": c["clip_id"], "shot": i,
                "mood": {w: round(float(x), 4) for w, x in
                         zip(moods, torch.softmax(ms * 100, dim=-1))},
                # Every content score, not only the winner: a brief names the
                # world it wants in words, and selecting on those words is what
                # replaces a person picking clips off a contact sheet.
                "content": {w: round(float(x), 4) for w, x in zip(CONTENT, cs)},
                "content_top": [CONTENT[j] for j in
                                torch.topk(cs, 3).indices.tolist()],
                "content_top_score": round(float(cs.max()), 4),
            })
    if os.path.exists(tmp):
        os.remove(tmp)

    if a.check:
        print(f"{'clip':16} {'shot':>4}  {'top content word':34} score")
        for r in rows:
            print(f"{r['clip_id']:16} {r['shot']:4}  {r['content_top'][0]:34} "
                  f"{r['content_top_score']:.3f}")
        print()
        print("If those names do not match the footage, nothing else in this")
        print("file is worth reading. CLIP's opinion about 'euphoric' is only as")
        print("good as its ability to see what is in front of it.")
        return 0

    doc = {
        "note": ("Per-shot CLIP embeddings reduced to two things: a distribution "
                 "over the MAP'S OWN mood vocabulary, and the top content words. "
                 "The bridge from music to picture runs through the words, not "
                 "through a shared embedding space -- MuLan and CLIP do not "
                 "share one."),
        "made_by": {"how": "model", "who": "assets/semantic.py",
                    "image_model": "openai/clip-vit-base-patch32",
                    "mood_vocabulary_from": a.mood_from,
                    "frames_per_shot": 1,
                    "not": ("one frame from the middle of each shot; a shot that "
                            "changes subject is described by its middle")},
        "mood_terms": moods, "content_vocabulary": CONTENT,
        "set": a.setname, "shots": rows,
    }
    json.dump(doc, open(out_p, "w"), indent=1)
    open(out_p, "a").write("\n")
    print(f"{len(rows)} shots -> {os.path.relpath(out_p, ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
