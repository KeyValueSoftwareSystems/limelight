"""One writer for the section-merge fact: consecutive same-label runs become one."""
from __future__ import annotations


def merge_sections(sections):
    merged = []
    for sec in sections or []:
        name = sec.get("label")
        if merged and merged[-1]["name"] == name:
            merged[-1]["to"] = sec["t1"]
        else:
            merged.append({"at": sec["t0"], "to": sec["t1"], "name": name})
    return merged
