import os, sys, time, glob, subprocess, shutil

ROFORMER_DIR = os.environ.get("ROFORMER_DIR", "work/stems-roformer")
OUT_DIR = os.environ.get("OUT_DIR", "work/stems-cascade")
TEMP_DIR = os.environ.get("TEMP_DIR", "work/stems-cascade-tmp")
os.makedirs(OUT_DIR, exist_ok=True)

instrumentals = sorted(glob.glob(os.path.join(ROFORMER_DIR, "*", "instrumental.wav")))
print(f"Found {len(instrumentals)} instrumentals from RoFormer", flush=True)

for i, inst_path in enumerate(instrumentals):
    slug = os.path.basename(os.path.dirname(inst_path))
    out_slug = os.path.join(OUT_DIR, slug)
    done_marker = os.path.join(out_slug, ".done")

    if os.path.exists(done_marker):
        print(f"[{i + 1}/{len(instrumentals)}] {slug} — skip", flush=True)
        continue

    voc_path = os.path.join(ROFORMER_DIR, slug, "vocals.wav")
    if not os.path.exists(voc_path):
        print(f"[{i + 1}/{len(instrumentals)}] {slug} — no vocals, skip", flush=True)
        continue

    t0 = time.time()
    print(
        f"[{i + 1}/{len(instrumentals)}] {slug} — htdemucs_6s on instrumental...",
        flush=True,
    )

    if os.path.exists(TEMP_DIR):
        shutil.rmtree(TEMP_DIR)
    os.makedirs(TEMP_DIR, exist_ok=True)

    result = subprocess.run(
        [
            "python",
            "-m",
            "demucs",
            "-n",
            "htdemucs_6s",
            "--device",
            "cuda",
            "-o",
            TEMP_DIR,
            inst_path,
        ],
        capture_output=True,
        text=True,
        timeout=600,
    )

    if result.returncode != 0:
        print(f"  FAIL: {result.stderr[:500]}", flush=True)
        continue

    demucs_out = None
    for root, dirs, files in os.walk(TEMP_DIR):
        wavs = [f for f in files if f.endswith(".wav")]
        if len(wavs) >= 4:
            demucs_out = root
            break

    if not demucs_out:
        print(f"  FAIL: no demucs output found", flush=True)
        continue

    produced = [f for f in os.listdir(demucs_out) if f.endswith(".wav")]
    print(f"  demucs produced: {sorted(produced)}", flush=True)

    os.makedirs(out_slug, exist_ok=True)
    shutil.copy2(voc_path, os.path.join(out_slug, "vocals.wav"))

    for sf in produced:
        if sf == "vocals.wav":
            continue
        shutil.copy2(os.path.join(demucs_out, sf), os.path.join(out_slug, sf))

    open(done_marker, "w").write(str(time.time()))
    final = sorted(f for f in os.listdir(out_slug) if f.endswith(".wav"))
    print(
        f"  OK {slug}: {len(final)} stems in {time.time() - t0:.0f}s -> {final}",
        flush=True,
    )

shutil.rmtree(TEMP_DIR, ignore_errors=True)
print("CASCADE_DONE", flush=True)
