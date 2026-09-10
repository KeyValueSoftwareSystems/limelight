"""A sample of the FMA corpus, in the format the scorer already reads.

    python3 tools/mkcorpus.py <fma_small.zip> <dest-dir> [n]

Real recordings only. The generator in synth/ is deliberately not used: a
percentile over generated music describes the distribution of the generator,
and nothing about the resulting number would reveal that.

Converted to 32 kHz mono WAV -- exactly what synth/out holds -- so the corpus
and our own songs go through the same loader and the same band analysis.
"""
import zipfile, random, os, subprocess, sys

def main():
    zp, dst = sys.argv[1], sys.argv[2]
    want = int(sys.argv[3]) if len(sys.argv) > 3 else 500
    os.makedirs(dst, exist_ok=True)
    z = zipfile.ZipFile(zp)
    names = [i for i in z.namelist() if i.endswith(".mp3")]
    random.Random(20260910).shuffle(names)
    tmp = os.path.join(dst, "_c.mp3")
    ok = bad = 0
    for n in names:
        if ok >= want:
            break
        out = os.path.join(dst, os.path.basename(n).replace(".mp3", ".wav"))
        if os.path.exists(out):
            ok += 1
            continue
        with open(tmp, "wb") as f:
            f.write(z.read(n))
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp,
                            "-ac", "1", "-ar", "32000", out], capture_output=True)
        if r.returncode == 0 and os.path.getsize(out) > 200000:
            ok += 1
        else:
            bad += 1
            if os.path.exists(out):
                os.remove(out)
    if os.path.exists(tmp):
        os.remove(tmp)
    print("corpus: %d tracks, %d unusable" % (ok, bad))

main()
