"""allin1 worker — runs in the `limelight-allin1` env (torch 2.6 + natten).

Standalone: analyzes one file, writes tempo/beats/downbeats/labelled segments as
JSON to the given output path (allin1 spams stdout, so we never write JSON there).

    python allin1_worker.py <audio_path> <out_json_path>
"""
from __future__ import annotations

import json
import os
import sys
import tempfile


def main() -> int:
    audio_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else None

    # natten 0.17.5 probes CUDA capability at import; on CPU-only torch that raises.
    import torch
    if not torch.cuda.is_available():
        torch.cuda.get_device_capability = lambda *a, **k: (0, 0)  # type: ignore

    # allin1 1.1.0 imports natten's OLD functional API (removed in 0.17.5). The new
    # helpers are the same neighborhood-attention math and run on CPU — shim the old
    # names onto them before importing allin1.
    import natten.functional as nf
    if not hasattr(nf, "natten2dav"):
        nf.natten1dqkrpb = lambda q, k, rpb, ks, d: nf.na1d_qk(q, k, kernel_size=ks, dilation=d, rpb=rpb)
        nf.natten1dav = lambda a, v, ks, d: nf.na1d_av(a, v, kernel_size=ks, dilation=d)
        nf.natten2dqkrpb = lambda q, k, rpb, ks, d: nf.na2d_qk(q, k, kernel_size=ks, dilation=d, rpb=rpb)
        nf.natten2dav = lambda a, v, ks, d: nf.na2d_av(a, v, kernel_size=ks, dilation=d)

    import allin1

    tmp = tempfile.mkdtemp(prefix="allin1_")
    try:
        result = allin1.analyze(audio_path, device="cpu",
                                demix_dir=os.path.join(tmp, "demix"),
                                spec_dir=os.path.join(tmp, "spec"),
                                keep_byproducts=False, multiprocess=False)
    except TypeError:
        result = allin1.analyze(audio_path, device="cpu")

    r = result[0] if isinstance(result, list) else result

    def flist(x):
        return [round(float(t), 4) for t in (x or [])]

    segments = [{"start": round(float(s.start), 3), "end": round(float(s.end), 3),
                 "label": getattr(s, "label", None)} for s in (getattr(r, "segments", None) or [])]

    out = {"bpm": float(r.bpm) if getattr(r, "bpm", None) else None,
           "beats": flist(getattr(r, "beats", [])),
           "downbeats": flist(getattr(r, "downbeats", [])),
           "segments": segments}

    if out_path:
        with open(out_path, "w") as fh:
            json.dump(out, fh)
    else:
        json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
