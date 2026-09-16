#!/usr/bin/env python3
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import composer as C

USAGE = "\n".join(
    [
        "portal/ask.py <song> <question> [args...]",
        "",
        "    overview                      the whole brief again",
        "    moment <i>                    one moment in full",
        "    section <i>                   one section in full",
        "    lane <name> <from_s> <to_s>   an instrument's level over a span",
        "    onsets <from_bar> <to_bar> [threshold]",
        "    compare <a,b,c> <from_bar> <to_bar>",
        "    chords <from_s> <to_s>",
        "    melody <from_s> <to_s>",
        "",
        "Every answer is JSON on stdout. Times are seconds; bars are bar numbers",
        "exactly as the overview prints them.",
    ]
)


def main(argv):
    if len(argv) < 3:
        print(USAGE)
        return 2
    song, what, rest = argv[1], argv[2], argv[3:]
    hub = os.environ.get("HUB_URL")
    if hub:
        C.HUB = hub.rstrip("/")
    overview = C.fetch_overview(song)
    overview["_song"] = song
    if what == "overview":
        print(C.format_overview(overview))
        return 0
    try:
        if what in ("moment", "section"):
            args = {"index": int(rest[0])}
        elif what == "lane":
            args = {"name": rest[0], "from_s": float(rest[1]), "to_s": float(rest[2])}
        elif what == "onsets":
            args = {"from_bar": int(rest[0]), "to_bar": int(rest[1])}
            if len(rest) > 2:
                args["threshold"] = float(rest[2])
        elif what == "compare":
            args = {
                "streams": [x.strip() for x in rest[0].split(",") if x.strip()],
                "from_bar": int(rest[1]),
                "to_bar": int(rest[2]),
            }
        elif what in ("chords", "melody"):
            args = {"from_s": float(rest[0]), "to_s": float(rest[1])}
        else:
            print(USAGE)
            return 2
    except (IndexError, ValueError):
        print(USAGE)
        return 2
    try:
        with open(os.environ.get("ASK_LOG", "/tmp/ask.log"), "a") as fh:
            fh.write(f"{song}  {what}  {' '.join(str(x) for x in rest)}\n")
    except OSError:
        pass
    out = C.handle_tool_call(what, args, overview)
    print(out if isinstance(out, str) else json.dumps(out, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
