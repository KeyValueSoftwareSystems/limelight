"use client";

import { useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { Topbar } from "@/components/portal/Topbar";
import { Footer } from "@/components/portal/Footer";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const setEffects = usePortalStore((s) => s.setEffects);
  const setLayouts = usePortalStore((s) => s.setLayouts);
  const setLayout = usePortalStore((s) => s.setLayout);
  const setRooms = usePortalStore((s) => s.setRooms);
  const setRoom = usePortalStore((s) => s.setRoom);
  const setLimits = usePortalStore((s) => s.setLimits);
  const setRig = usePortalStore((s) => s.setRig);
  const role = usePortalStore((s) => s.role);
  const pathname = usePathname();
  /* The editor is full-bleed: it carries its own rail and header. */
  const bare = pathname?.startsWith("/stage");

  /* Initial data load */
  useEffect(() => {
    document.body.dataset.role = role;

    /* The catalogue is not optional: buildClips needs it to draw a clip, so a
       swallowed failure here means an imported show renders as an empty
       timeline and nothing anywhere says why. Retry once, then say it out loud
       in the console rather than failing silently. */
    const loadEffects = (attempt = 0) =>
      api.effects
        .list()
        .then((d) => setEffects(d.effects))
        .catch((e) => {
          if (attempt < 2) return setTimeout(() => loadEffects(attempt + 1), 800);
          console.error(
            "limelight: could not load the effect catalogue — the timeline will not be able to draw clips. Is the portal running?",
            e,
          );
        });
    loadEffects();
    api.layouts.list().then((d) => {
      setLayouts(d.layouts);
      setLayout(d.default);
    }).catch(() => {});
    api.venues.search("").then((d) => {
      setRooms(d.venues);
      if (d.default) {
        const dflt = d.venues.find((v) => v.id === d.default) ?? d.venues[0];
        if (dflt) {
          setRoom({ id: dflt.id, name: dflt.name, layout: dflt.default, example: dflt.example });
        }
      }
    }).catch(() => {});
    api.limits.get().then(setLimits).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Sync role to DOM */
  useEffect(() => {
    document.body.dataset.role = role;
  }, [role]);

  /* Rig polling */
  useEffect(() => {
    const poll = () => {
      api.rig.status().then(setRig).catch(() => setRig(null));
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, [setRig]);

  const handleRigToggle = useCallback(async () => {
    const current = usePortalStore.getState().rig;
    if (!current) return;
    try {
      const result = await api.rig.arm(!current.armed);
      if (!result.error) setRig(result);
    } catch { /* noop */ }
  }, [setRig]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {!bare && <Topbar onRigToggle={handleRigToggle} />}
      <main className="flex-1 min-h-0 flex flex-col">{children}</main>
      {!bare && <Footer />}
    </div>
  );
}
