import os, sys, json, glob, time
HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("HF_HOME", os.path.join(HERE, "hf"))
import numpy as np, librosa
from transformers import AutoModel
LOCAL = os.path.join(HERE, "songformer-model")
sys.path.append(LOCAL); os.environ["SONGFORMER_LOCAL_DIR"] = LOCAL
m = AutoModel.from_pretrained(LOCAL, trust_remote_code=True, low_cpu_mem_usage=False)
m.to("cuda:0"); m.eval()
print("loaded", flush=True)
out_dir = os.path.join(HERE, "songformer-out"); os.makedirs(out_dir, exist_ok=True)
for w in sorted(glob.glob(os.path.join(HERE, "wav", "*.wav"))):
    slug = os.path.basename(w)[:-4]
    dst = os.path.join(out_dir, slug + ".json")
    if os.path.exists(dst): continue
    try:
        t0=time.time(); y,_ = librosa.load(w, sr=24000, mono=True)
        r = m(y.astype(np.float32))
        json.dump(r, open(dst,"w"), ensure_ascii=False)
        print("  %-26s %2d segments (%.1fs)"%(slug, len(r), time.time()-t0), flush=True)
    except Exception as e:
        print("  %-26s FAILED %s"%(slug, str(e)[:70]), flush=True)
print("SF_ALL_DONE", flush=True)
