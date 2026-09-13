# scores/

Drop `.score` files here. That is the whole setup.

The hub is one machine's copy of these files plus a small HTTP server, so when
the hub is unreachable — or is somebody's laptop that has gone home — the same
answers are available from this folder. Nothing is recomputed differently:
`hub/score_api.py` is the responder either way, and `tools/response.test.py`
compares the two side by side and fails if they ever disagree.

    python3 tools/response.py --list                  what is here
    python3 tools/response.py levels                  the whole response
    python3 tools/response.py levels --fields curves,signals --curves pace,energy
    python3 tools/response.py levels --from 25 --bars 9
    python3 tools/response.py levels --out /tmp/x.json

    tools/local-stack.sh seed                         push these to the local hub
    python3 tools/response.test.py                    prove the two agree

Scores are not committed — they are built by the pipeline and shared through
the hub — so this folder is gitignored and its contents live only on the
machine that put them here. Keep a copy somewhere that is not one laptop.
