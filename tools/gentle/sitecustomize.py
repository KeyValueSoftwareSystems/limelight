"""Cap OpenCV's thread pool before anything imports it.

OpenCV does not read OMP_NUM_THREADS; it has its own pool and takes every core
it can see. On a 12-core laptop that is the whole machine, and indexing a
six-minute video made the desktop unusable twice. Python imports sitecustomize
automatically when it is on PYTHONPATH, which is the only hook that runs before
assets/index.py does its own `import cv2`.
"""
import os
try:
    import cv2
    cv2.setNumThreads(int(os.environ.get("LIMELIGHT_THREADS", "2")))
except Exception:
    pass
