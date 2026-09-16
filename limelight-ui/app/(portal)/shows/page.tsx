"use client";

import { useEffect, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import { Button } from "@/components/ui/Button";
import type { ShowFile } from "@/lib/types";

export default function ShowsPage() {
  const [showList, setShowList] = useState<ShowFile[]>([]);
  const [loading, setLoading] = useState(true);
  const setSong = usePortalStore((s) => s.setSong);
  const setSeed = usePortalStore((s) => s.setSeed);
  const setEdits = usePortalStore((s) => s.setEdits);
  const setVenue = usePortalStore((s) => s.setVenue);
  const setShowId = usePortalStore((s) => s.setShowId);
  const setShowVersion = usePortalStore((s) => s.setShowVersion);
  const setWant = usePortalStore((s) => s.setWant);
  const setPendingPlan = usePortalStore((s) => s.setPendingPlan);
  const setPlanText = usePortalStore((s) => s.setPlanText);
  const resetForShow = usePortalStore((s) => s.resetForShow);
  const songs = usePortalStore((s) => s.songs);
  const setSongs = usePortalStore((s) => s.setSongs);
  const router = useRouter();

  useEffect(() => {
    api.shows.list().then((d) => {
      setShowList(d.shows);
      setLoading(false);
    }).catch(() => setLoading(false));
    if (!songs.length) api.songs.list().then((d) => setSongs(d.songs)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpen = useCallback(
    (sf: ShowFile) => {
      resetForShow();
      const match = songs.find((s) => s.name === sf.song);
      if (match) setSong(match);
      setSeed(sf.seed);
      setEdits(sf.edits);
      setVenue(sf);
      setShowId(sf.id);
      setShowVersion(sf.version);
      setWant(sf.appetite ?? null);
      /* Hand the show's OWN plan to the stage. Without it the stage falls back
         to the song's show file, which is shared by every show made from that
         song — so two different saved shows opened as the same one. */
      setPendingPlan(sf.plan ?? null);
      setPlanText(sf.plan_text ?? "");
      router.push(`/stage?song=${encodeURIComponent(sf.song)}&seed=${sf.seed}`);
    },
    [resetForShow, songs, setSong, setSeed, setEdits, setVenue, setShowId, setShowVersion, setWant,
     setPendingPlan, setPlanText, router],
  );

  return (
    <div className="flex flex-col overflow-hidden flex-1">
      <div className="flex-none px-[var(--spacing-s6)] pt-[var(--spacing-s5)] pb-[var(--spacing-s4)] border-b border-solid border-line">
        <div className="display">Shows</div>
        <div className="label mt-[7px]">
          {loading ? "loading…" : `${showList.length} saved show${showList.length === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto pb-[var(--spacing-s7)]">
        {showList.map((sf) => (
          <div
            key={sf.id}
            className="flex items-center gap-[var(--spacing-s4)] px-[var(--spacing-s6)] py-[var(--spacing-s4)] border-b border-solid border-line hover:bg-accent-soft transition-colors cursor-pointer"
            onClick={() => handleOpen(sf)}
          >
            <div className="flex-1 min-w-0">
              <b className="block text-[length:var(--text-lg)] font-medium truncate">{sf.name}</b>
              <span className="block mt-1 text-[length:var(--text-sm)] text-dim">
                {sf.song} · seed {sf.seed} · v{sf.version} · by {sf.author}
              </span>
              {sf.designed_for && (
                <span className="block mt-1 text-[length:var(--text-sm)] text-dim">
                  for {sf.designed_for.venue_name}
                  {sf.designed_for.layout ? ` · ${sf.designed_for.layout}` : ""}
                </span>
              )}
              {sf.invalid && (
                <span className="block mt-1 text-[length:var(--text-sm)] text-warn">{sf.invalid}</span>
              )}
            </div>
            <span className="mono text-dim">{sf.edits.length} edits</span>
            <Button variant="link">Open</Button>
          </div>
        ))}
        {!loading && !showList.length && (
          <div className="text-dim text-center py-[var(--spacing-s7)]">No saved shows yet</div>
        )}
      </div>
    </div>
  );
}
