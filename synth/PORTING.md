# Porting musicstate into a map

Use the one in the service:

```
PYTHONPATH=musicstate/src python3 -c "
import json; from musicstate.port import to_map
json.dump(to_map(json.load(open('song.musicstate.json'))), open('out.map.json','w'), indent=1)"
```

`synth/port_musicstate.py` used to live here and has been deleted. Dheeraj's `musicstate/port.py`
does the same job, is packaged, has tests, and belongs to the lane that owns the format it reads.
Checked against the same input first: identical beats, downbeats, chapters, sections, moments,
spans, energy, stems, vectors and grid — the two agreed on every field.

**One writer per fact.** Two converters would eventually disagree, and then neither could be
trusted.

Afterwards, `python3 synth/upgrade_map.py <map>` derives accents, brightness, vocal silence and
microtiming from the frame stream that musicstate already carries.
