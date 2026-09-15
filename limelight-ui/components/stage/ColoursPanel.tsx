"use client";

import { useEffect, useCallback, useState } from "react";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import type { ColourSwatch } from "@/lib/types";

const PALETTE: ColourSwatch[] = [
  { name: "red", hex: "#ff0000" },
  { name: "amber", hex: "#ffb300" },
  { name: "gold", hex: "#ffcc00" },
  { name: "green", hex: "#00ff00" },
  { name: "cyan", hex: "#00ccff" },
  { name: "blue", hex: "#0000ff" },
  { name: "violet", hex: "#8000ff" },
  { name: "magenta", hex: "#ff00cc" },
  { name: "pink", hex: "#ff6090" },
  { name: "white", hex: "#ffffff" },
];

export function ColoursPanel() {
  const song = usePortalStore((s) => s.song);
  const colours = usePortalStore((s) => s.colours);
  const setColours = usePortalStore((s) => s.setColours);
  const author = usePortalStore((s) => s.author);
  const [all, setAll] = useState<ColourSwatch[]>([]);

  useEffect(() => {
    if (!song) return;
    api.colours
      .get(song.name)
      .then((d) => {
        setAll(d.colours);
        const mine = d.personalities.find((p) => p.user === author);
        if (mine) setColours(mine.colours.map((c) => c.name));
      })
      .catch(() => {});
  }, [song, author, setColours]);

  const toggle = useCallback(
    (name: string) => {
      const next = colours.includes(name)
        ? colours.filter((c) => c !== name)
        : [...colours, name];
      setColours(next);
      if (song && author) {
        api.colours.set(song.name, author, next).catch(() => {});
      }
    },
    [colours, setColours, song, author],
  );

  if (!song) return null;

  return (
    <div className="px-[var(--spacing-s5)] pt-[var(--spacing-s5)] mt-[var(--spacing-s5)] border-t border-solid border-line">
      <div className="label">Artist colours</div>
      <div className="muted mt-1">
        Pick colours associated with the artist. They influence the palette the baker uses.
      </div>
      <div className="flex flex-wrap gap-[6px] mt-[var(--spacing-s3)]">
        {PALETTE.map((c) => {
          const active = colours.includes(c.name);
          return (
            <button
              key={c.name}
              type="button"
              onClick={() => toggle(c.name)}
              title={c.name}
              className={`w-[26px] h-[26px] rounded-full border-2 border-solid cursor-pointer transition-transform ${
                active ? "border-ink scale-110" : "border-transparent hover:scale-105"
              }`}
              style={{ background: c.hex }}
            />
          );
        })}
      </div>
      {all.length > 0 && (
        <div className="mt-[var(--spacing-s3)]">
          <div className="text-[length:var(--text-xs)] text-dimmer">
            Community: {all.map((c) => c.name).join(", ")}
          </div>
        </div>
      )}
    </div>
  );
}
