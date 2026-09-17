"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import * as api from "@/lib/api";
import { ArrowLeft, Minus, Plus, Trash2 } from "lucide-react";
import { Field, Button } from "@/components/ui";
import { RigPreview } from "@/components/venues/RigPreview";
import { RigPlan, type Placed } from "@/components/venues/RigPlan";
import type { Fixture } from "@/lib/types";

const KINDS: { id: string; label: string; blurb: string; z: number; y: number }[] = [
  { id: "par5", label: "PAR", blurb: "Flat colour wash, 5 channels", z: 2.4, y: 0 },
  { id: "wash12", label: "Wash mover", blurb: "Colour on a moving yoke, 12 channels", z: 3.0, y: 0.4 },
  { id: "spot29", label: "Spot mover", blurb: "Pan, tilt, gobo and CMY, 29 channels", z: 3.6, y: 0.2 },
  { id: "blinder1", label: "Blinder", blurb: "Straight into the room, 1 channel", z: 2.0, y: 0.6 },
  { id: "strobe3", label: "Strobe", blurb: "3 channels", z: 2.8, y: 0.6 },
  { id: "laser8", label: "Laser", blurb: "8 channels", z: 1.2, y: 0.8 },
  { id: "pixelbar24", label: "Pixel bar", blurb: "24 cells, 24 channels", z: 1.0, y: 0.2 },
];

const SPREAD: Record<string, number> = {
  par5: 0.75, wash12: 1.1, spot29: 1.3, blinder1: 1.6,
  strobe3: 2.0, laser8: 2.4, pixelbar24: 6.4,
};

const UNIVERSE = 512;

export default function EditVenuePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const venueId = params?.id ?? "";
  const [name, setName] = useState("");
  const [rigName, setRigName] = useState("House rig");
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Fixture[]>([]);
  const [channels, setChannels] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nextKey = useRef(0);

  /* The rig as it stands becomes the plan: same fixtures, same metres, so a
     first drag moves what is really hanging rather than a fresh guess. */
  useEffect(() => {
    if (!venueId) return;
    let live = true;
    api.venues
      .search()
      .then((d) => {
        if (!live) return;
        const v = (d.venues ?? []).find((x) => x.id === venueId);
        if (!v) { setError("That venue is no longer in the catalogue."); setLoaded(true); return; }
        setName(v.name);
        setLocked(!!v.locked);
        const file = v.default ?? v.layouts[0]?.file;
        const rig = (d.layouts ?? []).find((l) => l.file === file);
        setRigName(v.layouts.find((l) => l.file === file)?.name ?? "House rig");
        setPlaced(
          (rig?.fixture_list ?? [])
            .filter((f) => Array.isArray(f.at) && f.at.length === 3)
            .map((f, i) => ({
              key: `f${i}`,
              type: f.type,
              at: [f.at![0], f.at![1], f.at![2]] as [number, number, number],
            })),
        );
        nextKey.current = (rig?.fixture_list ?? []).length;
        setLoaded(true);
      })
      .catch(() => { if (live) { setError("Could not load that venue."); setLoaded(true); } });
    return () => { live = false; };
  }, [venueId]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of placed) c[f.type] = (c[f.type] ?? 0) + 1;
    return c;
  }, [placed]);

  const body = useMemo(
    () => JSON.stringify(placed.map((f) => ({ type: f.type, at: f.at }))),
    [placed],
  );

  /* The patch and the preview both come from the server, so what is drawn is
     what would be written - the page never does its own addressing. */
  useEffect(() => {
    if (!placed.length) { setPreview([]); setChannels(0); return; }
    let live = true;
    fetch("/api/venues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry: true, name: name || "Preview", placed: JSON.parse(body) }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (d.error) { setError(d.error); return; }
        setError(null);
        setPreview(d.layout.fixtures);
        setChannels(d.total_channels);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [body, name, placed.length]);

  const add = useCallback((kind: typeof KINDS[number]) => {
    setPlaced((cur) => {
      const mine = cur.filter((f) => f.type === kind.id).length;
      const spread = SPREAD[kind.id] ?? 0.75;
      /* new fixtures land beside the last of their kind, so adding eight PARs
         gives a row rather than a stack */
      const x = Math.max(-4.5, Math.min(4.5, -((mine * spread) / 2) + mine * spread));
      const key = `f${nextKey.current++}`;
      setSelected(key);
      return [...cur, { key, type: kind.id, at: [Math.round(x * 20) / 20, kind.y, kind.z] }];
    });
  }, []);

  const removeOne = useCallback((kindId: string) => {
    setPlaced((cur) => {
      const last = [...cur].reverse().find((f) => f.type === kindId);
      return last ? cur.filter((f) => f.key !== last.key) : cur;
    });
  }, []);

  const moveOne = useCallback((key: string, x: number, z: number) => {
    setPlaced((cur) => cur.map((f) => (f.key === key ? { ...f, at: [x, f.at[1], z] } : f)));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/venues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: venueId,
          name,
          rig_name: rigName,
          placed: placed.map((f) => ({ type: f.type, at: f.at })),
        }),
      });
      const out = await res.json();
      if (out?.error) { setError(out.error); return; }
      router.push("/venues");
    } catch {
      setError("Could not reach the server. Check it is running and try again.");
    } finally {
      setSaving(false);
    }
  }, [venueId, name, rigName, placed, router]);

  const over = channels > UNIVERSE;
  const chosen = placed.find((f) => f.key === selected);

  return (
    <div className="flex flex-col overflow-hidden flex-1 animate-in">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="liquid liquid-flush sticky top-0 z-30 px-[28px] pt-[20px] pb-[16px]">
          <button
            type="button"
            onClick={() => router.push("/venues")}
            className="inline-flex items-center gap-[6px] mb-[10px] p-0 border-0 bg-transparent text-[13px] text-ink-dim hover:text-ink cursor-pointer transition-colors duration-200"
          >
            <ArrowLeft size={14} />
            All venues
          </button>
          <div className="flex items-center gap-[20px] flex-wrap">
            <div className="min-w-0">
              <h1 className="text-[26px] font-semibold tracking-[-0.025em] m-0 leading-[1.15] text-ink">
                {loaded ? name || "Venue" : "Loading\u2026"}
              </h1>
              <p className="text-[12.5px] text-ink-dimmer mt-[4px] m-0 leading-[1.3]">
                {locked
                  ? "This rig is not open to you, so changes cannot be saved."
                  : "Drag a fixture to move it, or add and remove them below."}
              </p>
            </div>
            <span className="flex-1 min-w-[16px]" />
            <Button
              variant="primary"
              disabled={!name.trim() || !placed.length || over || saving || locked}
              onClick={save}
            >
              {saving ? "Saving\u2026" : "Save rig"}
            </Button>
          </div>
        </div>

        <div className="px-[28px] pt-[18px] pb-[48px] grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_330px] gap-[22px] items-start">
          <section className="flex flex-col gap-[16px] min-w-0">
            <div className="panel rounded-[var(--radius-lg)] p-[16px] grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
              <label className="flex flex-col gap-[6px]">
                <span className="text-[11px] font-medium text-ink-dimmer">Venue name</span>
                <Field
                  type="text"
                  placeholder="The Warehouse"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-[6px]">
                <span className="text-[11px] font-medium text-ink-dimmer">Rig name</span>
                <Field
                  type="text"
                  placeholder="House rig"
                  value={rigName}
                  onChange={(e) => setRigName(e.target.value)}
                />
              </label>
            </div>

            <div className="panel rounded-[var(--radius-lg)] p-[14px] flex flex-col gap-[10px]">
              <div className="flex items-baseline gap-[8px]">
                <span className="text-[11px] font-medium text-ink-dimmer">Plan</span>
                <span className="flex-1" />
                <span className="mono text-[11px] text-ink-dimmer tabular-nums">
                  {chosen
                    ? `${chosen.at[0].toFixed(2)} m across · ${chosen.at[2].toFixed(2)} m up`
                    : "Drag a fixture to place it"}
                </span>
                {chosen && (
                  <button
                    type="button"
                    onClick={() => {
                      setPlaced((cur) => cur.filter((f) => f.key !== chosen.key));
                      setSelected(null);
                    }}
                    title="Remove this fixture"
                    className="liquid liquid-key flex items-center justify-center w-[26px] h-[26px] rounded-[var(--radius-sm)] text-danger cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <RigPlan
                fixtures={placed}
                selected={selected}
                onMove={moveOne}
                onSelect={setSelected}
              />
            </div>

            <div className="panel rounded-[var(--radius-lg)] overflow-hidden">
              {KINDS.map((k, i) => {
                const n = counts[k.id] ?? 0;
                return (
                  <div
                    key={k.id}
                    className={`flex items-center gap-[12px] px-[16px] py-[11px] ${
                      i ? "border-t border-solid border-[var(--edge)]" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[13px] ${n ? "text-ink font-medium" : "text-ink-dim"}`}>
                        {k.label}
                      </span>
                      <span className="block text-[11px] text-ink-dimmer truncate">{k.blurb}</span>
                    </span>
                    <span className="flex items-center gap-[6px] flex-none">
                      <button
                        type="button"
                        onClick={() => removeOne(k.id)}
                        disabled={!n}
                        aria-label={`One fewer ${k.label}`}
                        className="liquid liquid-key flex items-center justify-center w-[28px] h-[28px] rounded-[var(--radius-sm)] text-ink-dim cursor-pointer disabled:opacity-35 disabled:cursor-default"
                      >
                        <Minus size={13} />
                      </button>
                      <span className="mono w-[26px] text-center text-[13px] tabular-nums text-ink">
                        {n}
                      </span>
                      <button
                        type="button"
                        onClick={() => add(k)}
                        aria-label={`One more ${k.label}`}
                        className="liquid liquid-key flex items-center justify-center w-[28px] h-[28px] rounded-[var(--radius-sm)] text-ink-dim cursor-pointer"
                      >
                        <Plus size={13} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>

            {error && <p className="m-0 text-[12.5px] text-danger leading-[1.5]">{error}</p>}
          </section>

          <aside className="panel rounded-[var(--radius-lg)] overflow-hidden lg:sticky lg:top-[92px]">
            <RigPreview fixtures={preview} className="w-full aspect-[3/2]" />
            <div className="px-[14px] py-[13px] flex flex-col gap-[7px]">
              <span className="text-[13px] font-semibold text-ink">
                {name.trim() || "Untitled venue"}
              </span>
              <span className="mono text-[11.5px] text-ink-dim tabular-nums">
                {placed.length} fixture{placed.length === 1 ? "" : "s"} · {channels} channels
              </span>
              <div className="h-[6px] rounded-full overflow-hidden liquid-well mt-[2px]">
                <div
                  className="h-full rounded-full transition-[width] duration-300"
                  style={{
                    width: `${Math.min(100, (channels / UNIVERSE) * 100)}%`,
                    background: over ? "var(--danger)" : "var(--accent)",
                  }}
                />
              </div>
              <span className={`text-[11px] ${over ? "text-danger" : "text-ink-dimmer"}`}>
                {over
                  ? `${channels} channels is past the 512 a universe holds. Remove some fixtures.`
                  : `${UNIVERSE - channels} channels left in universe 0.`}
              </span>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
