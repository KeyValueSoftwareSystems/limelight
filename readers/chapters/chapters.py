#!/usr/bin/env python3
"""Map in, chapter list out. The whole point is that this is trivial."""
import json, sys

def mmss(t):
    return f"{int(t) // 60:02d}:{int(t) % 60:02d}"

def main(path):
    m = json.load(open(path))
    for c in m.get("chapters", []):
        print(f"{mmss(c['at'])} {c['name']}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "../../maps/example.map.json")
