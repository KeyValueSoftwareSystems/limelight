"use client";

import { useEffect, useCallback, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { usePortalStore } from "@/store/portal";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useAnimationLoop } from "@/hooks/useAnimationLoop";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { placeFixtures } from "@/lib/fixtures";
import { mmss, clamp } from "@/lib/grid";
import { colourName, hexToRgb01, extractPalette, paletteChanged } from "@/lib/palette";
import * as api from "@/lib/api";

import { StagePreview } from "@/components/stage/StagePreview";
import { RoleToggle } from "@/components/portal/RoleToggle";
import { OperatorRail } from "@/components/editor/OperatorRail";
import { OperatorConsole } from "@/components/stage/OperatorConsole";
import { OperatorStatus } from "@/components/stage/OperatorStatus";
import { ChatPanel } from "@/components/editor/ChatPanel";
import { TargetLine } from "@/components/stage/TargetLine";
import { VenuePicker } from "@/components/venues/VenuePicker";
import { StageTimeline } from "@/components/editor/StageTimeline";
import { SaveShowDialog } from "@/components/editor/SaveShowDialog";
import { Sidebar } from "@/components/editor/Sidebar";
import { RigControl } from "@/components/portal/RigControl";
import { buildClips, tileForClip } from "@/lib/clips";
import { planToEdits, editsToPlan, type V2Plan } from "@/lib/planConvert";
import { seedLayers } from "@/lib/layers";
import { buildShowFile, serializeShowFile, showFileName } from "@/lib/showfile";
import { downloadText } from "@/lib/download";
import type { Clip, Edit, PaletteColour } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import type { Venue } from "@/lib/types";

/** The undo token every part of one gesture carries — a drag, a trim, a slider
 *  sweep, and the take-over that may start one. See store/portal.ts: writes
 *  sharing a token collapse into a single step. */
const LIVE = "live";

/** A generator failure is a Python traceback. Show the one line that says what
 *  went wrong, and say what to do about it - never the last 600 characters of
 *  stderr, which is how an energy curve ended up in an alert box. */
function readableGenerateError(raw: string): string {
  if (/no score|score not found|FileNotFoundError.*\.score/i.test(raw)) {
    return "That track has no score yet. Wait for the analysis to finish, then generate.";
  }
  if (/beats|downbeats|grid/i.test(raw) && /empty|missing|none/i.test(raw)) {
    return "The score has no beat grid, so there is nothing to build against.";
  }
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .reverse()
    .find((l) => /Error|Exception/.test(l));
  return line ? `Could not build the show: ${line.slice(0, 160)}` : "Could not build the show.";
}

export default function StagePage() {
  const router = useRouter();
  const { clockRef, load, pause, seek, toggle, position, playing } =
    useAudioPlayer();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [stageMsg, setStageMsg] = useState<string | null>(null);
  const rebuildTokenRef = useRef(0);
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);

  /* Saving asks for the name in a dialog rather than reading it off a box in
     the header — see SaveShowDialog. `savedName` is what the last save called
     this show; until there is one, the name comes from the record it was opened
     from, so re-saving prefills instead of starting blank. */
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  /* The editor's height is the creator's to choose: pull it up while placing
     clips, push it down while judging the look. A fixed ratio is always wrong
     for one of those. */
  const [editorH, setEditorH] = useState(300);
  /* Once the creator drags the divider, the editor is theirs and stops
     resizing itself to the lanes. */
  const userSizedRef = useRef(false);

  const [railW, setRailW] = useState(244);
  const [asideW, setAsideW] = useState(288);

  /* The rails either side of the editor drag too, so the timeline can be made
     as wide as the work needs. */
  const startRail = useCallback((side: "left" | "right") => (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      if (side === "left") setRailW(Math.round(Math.min(Math.max(180, ev.clientX), 460)));
      else setAsideW(Math.round(Math.min(Math.max(220, window.innerWidth - ev.clientX), 520)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  const fitEditor = useCallback((natural: number) => {
    if (userSizedRef.current) return;
    const box = columnRef.current?.getBoundingClientRect();
    const cap = box ? box.height - 220 : 520;
    setEditorH(Math.round(Math.min(Math.max(natural, 220), Math.max(220, cap))));
  }, []);
  const columnRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLElement>(null);

  const MIN_EDITOR = 220;
  const MIN_PREVIEW = 150;

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    userSizedRef.current = true;
    const move = (ev: PointerEvent) => {
      const box = columnRef.current?.getBoundingClientRect();
      if (!box) return;
      const next = box.bottom - ev.clientY;
      setEditorH(
        Math.max(MIN_EDITOR, Math.min(next, box.height - MIN_PREVIEW)),
      );
    };
    /* The column decides what the editor actually got — see the section below.
       Taking that back as the new height keeps the number honest, so a later
       window resize does not suddenly inflate the editor to a height the
       creator never dragged it to. */
    const up = () => {
      const got = editorRef.current?.getBoundingClientRect().height;
      if (got) setEditorH(Math.round(got));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);
  const rehydratedRef = useRef(false);

  /* read URL params once on mount (safe for SSR since guarded by typeof window) */
  const urlParams = useMemo(() => {
    if (typeof window === "undefined")
      return { song: null, seed: null, layout: null, show: null, songs: null };
    const sp = new URLSearchParams(window.location.search);
    /* `layout` makes a rig deep-linkable, the same way song and seed already are:
       a show is {score, seed, edits} and the RIG is the venue's, so being able to
       say "this song, on that rig" in a URL is how you compare two rooms. */
    return {
      song: sp.get("song"),
      seed: sp.get("seed"),
      layout: sp.get("layout"),
      show: sp.get("show"),
      songs: sp.get("songs"),
    };
  }, []);

  const song = usePortalStore((s) => s.song);
  const setSong = usePortalStore((s) => s.setSong);
  const setSeed = usePortalStore((s) => s.setSeed);
  const setSongs = usePortalStore((s) => s.setSongs);
  const show = usePortalStore((s) => s.show);
  const edits = usePortalStore((s) => s.edits);
  const venue = usePortalStore((s) => s.venue);
  const role = usePortalStore((s) => s.role);
  const sel = usePortalStore((s) => s.sel);
  const arm = usePortalStore((s) => s.arm);
  const effects = usePortalStore((s) => s.effects);

  const setShow = usePortalStore((s) => s.setShow);
  const setFrames = usePortalStore((s) => s.setFrames);
  const setApplied = usePortalStore((s) => s.setApplied);
  const setJob = usePortalStore((s) => s.setJob);
  const setPlace = usePortalStore((s) => s.setPlace);
  const setNatural = usePortalStore((s) => s.setNatural);
  const setSecIndex = usePortalStore((s) => s.setSecIndex);
  const setView = usePortalStore((s) => s.setView);
  const setShowId = usePortalStore((s) => s.setShowId);
  const setShowVersion = usePortalStore((s) => s.setShowVersion);
  const setArm = usePortalStore((s) => s.setArm);
  const setSel = usePortalStore((s) => s.setSel);
  const removeEdit = usePortalStore((s) => s.removeEdit);
  const undo = usePortalStore((s) => s.undo);
  const redo = usePortalStore((s) => s.redo);
  const endEditGroup = usePortalStore((s) => s.endEditGroup);
  const canUndo = usePortalStore((s) => s.past.length > 0);
  const canRedo = usePortalStore((s) => s.future.length > 0);
  const addEdit = usePortalStore((s) => s.addEdit);
  const updateEdit = usePortalStore((s) => s.updateEdit);
  const setEdits = usePortalStore((s) => s.setEdits);
  const setV2 = usePortalStore((s) => s.setV2);
  const setPlanText = usePortalStore((s) => s.setPlanText);
  const setPendingPlan = usePortalStore((s) => s.setPendingPlan);
  const setPalette = usePortalStore((s) => s.setPalette);
  const setPaletteBase = usePortalStore((s) => s.setPaletteBase);
  const setRoom = usePortalStore((s) => s.setRoom);
  const setLayout = usePortalStore((s) => s.setLayout);
  const setRig = usePortalStore((s) => s.setRig);
  const showId = usePortalStore((s) => s.showId);

  /* seed, layout, want, author, room, v2 and planText are deliberately NOT
     subscribed here. handleSave and rebuild read them off the store at the
     moment they run — a subscription would re-render this page, and with it the
     whole editor, every time any of them changed. */

  /* ── rehydrate song from URL params on page refresh ──────────────────── */
  useEffect(() => {
    if (rehydratedRef.current) return;
    if (song) {
      rehydratedRef.current = true;
      return;
    }

    const songParam = urlParams.song;
    const seedParam = urlParams.seed;
    if (!songParam) {
      rehydratedRef.current = true;
      return;
    }
    rehydratedRef.current = true;

    if (seedParam) setSeed(Number(seedParam));
    if (urlParams.layout) setLayout(urlParams.layout);

    /* A saved show is addressable. Reopening or refreshing ?show=<id> restores
       the record itself rather than falling back to whatever the song would
       generate on its own. */
    const showParam = urlParams.show;
    if (showParam && !usePortalStore.getState().pendingPlan) {
      api.shows
        .list()
        .then((d) => {
          const sf = (d.shows || []).find((x) => x.id === showParam);
          if (!sf) {
            setStageMsg("That show is no longer in the library.");
            return;
          }
          setSeed(sf.seed);
          setEdits(sf.edits);
          setShowId(sf.id);
          setShowVersion(sf.version);
          setPendingPlan(sf.plan ?? null);
          setPlanText(sf.plan_text ?? "");
        })
        .catch(() => setStageMsg("Could not load that show. Check your connection and try again."));
    }
    const listParam = urlParams.songs;
    if (listParam) {
      const names = listParam
        .split(",")
        .map((n: string) => decodeURIComponent(n))
        .filter(Boolean);
      if (names.length) usePortalStore.getState().setSetlist(names);
    }
    queueMicrotask(() => setStageMsg("Loading track\u2026"));

    api.songs
      .list()
      .then((d) => {
        setSongs(d.songs);
        const found = d.songs.find((s) => s.name === songParam);
        if (found) {
          setSong(found);
        } else {
          setStageMsg(`No track called \u201c${songParam}\u201d is in the library.`);
        }
      })
      .catch(() => {
        setStageMsg("Could not reach the library. Check your connection and try again.");
      });
  }, [song, urlParams, setSong, setSeed, setSongs, setLayout, setEdits, setShowId, setShowVersion, setPendingPlan, setPlanText]);

  const importInputRef = useRef<HTMLInputElement>(null);


  /* Poll a started bake to completion and load its frames/show. Shared by the
     legacy seed+edits bake and the v2 plan bake — both return the same job. */
  const pollBake = useCallback(
    async (job: string, token: number) => {
      let status: Awaited<ReturnType<typeof api.show.status>> | null = null;
      for (let i = 0; i < 300; i++) {
        status = await api.show.status(job);
        if (token !== rebuildTokenRef.current) return null;
        if (status.state !== "baking") break;
        setStageMsg(`Building the show\u2026 ${(i / 4) | 0}s`);
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!status || status.state !== "ready") {
        setStageMsg(status?.error ?? "The build timed out. Try generating again.");
        return null;
      }
      const buf = await api.show.frames(status.frames_url!);
      if (token !== rebuildTokenRef.current) return null;
      const baked = status.show!;
      setFrames(buf);
      setShow(baked);
      setApplied(status.applied ?? []);
      setPlace(placeFixtures(baked));
      setNatural(baked.appetite_natural ?? null);
      setView(null);
      setStageMsg(null);

      /* Seed the palette swatches from the bake result when the user has not
         explicitly edited them. This covers the legacy seed+edits path (no show
         file) where applyPlan is never called, and keeps the swatches in step
         with the show's actual colours after every rebuild. */
      const cur = usePortalStore.getState();
      if (!paletteChanged(cur.palette, cur.paletteBase)) {
        const derived = extractPalette(baked.plan ?? baked);
        setPalette(derived);
        setPaletteBase(derived);
      }

      return baked;
    },
    [setFrames, setShow, setApplied, setPlace, setNatural, setView, setPalette, setPaletteBase],
  );

  const rigForPlan = useCallback(() => {
    const l = usePortalStore.getState().layout;
    return (l ?? "arc4-head.layout.json").replace(".layout.json", "");
  }, []);

  /* ── bake a show ─────────────────────────────────────────────────────────
     A v2 show (one imported from a plan) translates its edits back into a plan
     and renders through the portal baker; the legacy path bakes seed+edits.

     Everything is read LIVE from the store, not from this closure: the edit
     handlers call removeEdit()/addEdit() and then rebuild() in the same tick, so
     a closed-over `edits` would still be the pre-edit list and the change would
     never reach the bake — which is exactly "edits don't affect playback". */
  const rebuild = useCallback(async () => {
    const st = usePortalStore.getState();
    if (!st.song) return;
    const token = ++rebuildTokenRef.current;
    setStageMsg("Building the show\u2026");
    try {
      /* Only override the show's colours when the user has explicitly edited the
         palette. An untouched palette (palette === paletteBase) means "keep the
         show's own colours", so nothing is sent and the baker uses whatever the
         plan or song already declares. */
      const dirty = paletteChanged(st.palette, st.paletteBase);
      const palettePayload = dirty
        ? st.palette.map((c) => ({
            name: colourName(c.hex),
            rgb: hexToRgb01(c.hex),
          }))
        : undefined;

      let post: Awaited<ReturnType<typeof api.show.bake>>;
      if (st.v2 && st.show) {
        const planData = editsToPlan(
          st.edits,
          st.show,
          st.effects,
          st.planText,
        );
        if (palettePayload) {
          planData.palette = palettePayload;
        }
        post = await api.plan.bake(st.song.name, planData, rigForPlan());
      } else {
        post = await api.show.bake({
          song: st.song.name,
          seed: st.seed,
          edits: st.edits,
          appetite: st.want,
          layout: st.layout ?? undefined,
          palette: palettePayload,
        });
      }
      if (post.error) {
        setStageMsg(post.error);
        return;
      }
      setJob(post.job);
      await pollBake(post.job, token);
    } catch (e) {
      setStageMsg(e instanceof Error ? e.message : "The build failed.");
    }
  }, [rigForPlan, setJob, pollBake]);

  /* ── import a v2 plan: bake it, then translate it into editable clips ──────
     The raw plan bakes first (the baker's native input), then the returned
     show's sections/moments turn the plan into the Edit[] the timeline draws. */
  const applyPlan = useCallback(
    async (planData: V2Plan, what: string) => {
      if (!song) return;
      const token = ++rebuildTokenRef.current;
      try {
        if (!planData.states && !planData.gestures && !planData.bindings) {
          setStageMsg(`That ${what} is not a show plan.`);
          return;
        }
        setStageMsg(`Building ${what}\u2026`);
        setV2(true);
        setPlanText(typeof planData.plan === "string" ? planData.plan : "");
        /* The palette arrives with the plan: declared, once the show has been
           recoloured once, and otherwise derived from the colours its cues
           already use — the same derivation portal/recolour.py maps FROM. The
           baseline is set here too, because `reset` means "back to the show I
           opened", not "back to some venue's idea of it". */
        const opened = extractPalette(planData);
        setPalette(opened);
        setPaletteBase(opened);
        const post = await api.plan.bake(song.name, planData, rigForPlan());
        if (post.error) {
          setStageMsg(post.error);
          return;
        }
        setJob(post.job);
        const baked = await pollBake(post.job, token);
        if (baked)
          /* Every show comes in through here, so this is where lanes are
             seeded. A plan that carries them keeps them; one written before
             lanes existed gets the lanes the packing would have drawn it on
             anyway, ONCE — after which they are the clips' own property and
             nothing recomputes them. See lib/layers. */
          setEdits(
            seedLayers(
              planToEdits(planData, baked, usePortalStore.getState().effects),
              baked.grid,
            ),
          );
      } catch (e) {
        setStageMsg(
          e instanceof Error
            ? `Could not build ${what}: ${e.message}`
            : `Could not build ${what}.`,
        );
      }
    },
    [
      song,
      rigForPlan,
      setV2,
      setPlanText,
      setJob,
      setEdits,
      pollBake,
      setPalette,
      setPaletteBase,
    ],
  );

  /* A show file may be nested under `plan`, or be the plan itself. */
  const asPlan = (raw: Record<string, unknown>): V2Plan =>
    (raw.states || raw.gestures || raw.bindings
      ? raw
      : (raw.plan as Record<string, unknown>)?.states
        ? raw.plan
        : raw) as unknown as V2Plan;

  /* ── recolouring ─────────────────────────────────────────────────────────
     The show as it stands goes to portal/recolour.py with the colours wanted;
     it maps the show's existing palette onto them positionally, rewrites every
     cue, and hands back a plan. That plan is then applied like any other, which
     is what regenerates the show — one round trip, not two. */
  const handleRecolour = useCallback(
    async (colours: PaletteColour[]) => {
      const st = usePortalStore.getState();
      if (!st.song || !st.show || colours.length < 2) return;
      setStageMsg("Recolouring\u2026");
      try {
        const plan = editsToPlan(st.edits, st.show, st.effects, st.planText);
        const out = await api.recolour.apply(
          plan,
          colours.map((c) => ({
            name: colourName(c.hex),
            rgb: hexToRgb01(c.hex),
          })),
        );
        if (out.error) {
          setStageMsg(out.error);
          return;
        }
        await applyPlan(asPlan(out.showfile), "recolour");
      } catch (e) {
        setStageMsg(
          e instanceof Error
            ? "Recolour failed: " + e.message
            : "Recolour failed.",
        );
      }
    },
    [applyPlan],
  );

  const importPlan = useCallback(
    async (file: File) => {
      try {
        const raw = JSON.parse(await file.text()) as Record<string, unknown>;
        const plan = asPlan(raw);
        /* Say what was loaded. Two files with the same name in two folders can
           differ by two thirds of their cues, and the only way to tell which one
           the dialog handed over is to count what came in. */
        const n = (k: string) => ((plan as Record<string, unknown>)[k] as unknown[] | undefined)?.length ?? 0;
        setStageMsg(
          `Importing ${file.name} \u00b7 ${n("states")} looks, ` +
          `${n("bindings")} bindings, ${n("gestures")} cues\u2026`,
        );
        await applyPlan(plan, `imported ${file.name} — ${n("states")}/${n("bindings")}/${n("gestures")}`);
      } catch (e) {
        setStageMsg(
          e instanceof Error ? "Import failed: " + e.message : "Import failed.",
        );
      }
    },
    [applyPlan],
  );

  /* The other half of import. Saving already writes this exact document to the
     hub, but the copy it leaves is the hub's — so a show could be imported from
     a file and never got back out as one.

     The timeline is the source, not the last save: editsToPlan() is the same
     call handleSave makes, off the same store, so what lands in Downloads is
     what is on screen — edits you have not saved included. No round trip, and
     nothing here needs a show to have been named or saved first. */
  const handleDownload = useCallback(() => {
    const st = usePortalStore.getState();
    if (!st.show || !st.song) return;
    const name = showFileName(st.song.name);
    try {
      const plan = editsToPlan(st.edits, st.show, st.effects, st.planText);
      const doc = buildShowFile(st.song.name, plan);
      downloadText(name, serializeShowFile(doc));
      const cues =
        (doc.states?.length ?? 0) +
        (doc.bindings?.length ?? 0) +
        (doc.gestures?.length ?? 0);
      setStageMsg(`Downloaded ${name} \u00b7 ${cues} cues.`);
    } catch (e) {
      setStageMsg(
        e instanceof Error
          ? "Download failed: " + e.message
          : "Download failed.",
      );
    }
  }, []);

  /* Send-to-rig lives on this page too. Arming needs the baked frames to be ON
     the rig first: /api/rig/at loads them, and without that hand-over the server
     refuses with "no show loaded". So on arm we post the current bake at the
     audio position, THEN arm. The layout polls rig status into the store every
     second, so the pill stays fresh. */
  /* What the listener is HEARING now: the engine position minus the output
     latency and the person's nudge -- the same number the preview draws for.
     The rig used to be sent the raw position, so the real lamps ran ahead of
     the sound by the whole output buffer while the preview did not, and the
     two could never agree. The lamps' own delay is the rig's `lead_ms` trim,
     applied on the portal side. */
  const heard = useCallback(() => {
    const st = usePortalStore.getState();
    return position() - st.syncLatency - st.syncNudge;
  }, [position]);

  /* Score to show, from the page. The chain was upload -> score in the hub and
     show -> lamps here, with the middle step only ever run by hand on a
     terminal. /api/compose with the cue engine authors and publishes, then the
     page reloads so the timeline and the lamps both pick up the new file. */
  const [generating, setGenerating] = useState(false);
  const handleGenerate = useCallback(async () => {
    if (!song) return;
    setGenerating(true);
    setStageMsg("Building the show\u2026");
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* song.name, not song. The whole Song object was going over the wire and
           the server took os.path.basename(str(song)) of it, so the "song name"
           it looked for was a Python dict repr - which is why the failure came
           back as a wall of energy values. */
        body: JSON.stringify({ song: song.name, engine: "cue" }),
      });
      const out = await res.json();
      if (out?.error) {
        setStageMsg(readableGenerateError(String(out.error)));
        return;
      }
      window.location.reload();
    } catch {
      setStageMsg("Could not reach the server. Check it is running and try again.");
    } finally {
      setGenerating(false);
    }
  }, [song]);


  const handleRigToggle = useCallback(async () => {
    const st = usePortalStore.getState();
    const current = st.rig;
    if (!current) return;
    const want = !current.armed;
    try {
      if (want && st.job) await api.rig.at(st.job, heard());
      const result = await api.rig.arm(want);
      if (result.error) {
        setStageMsg(`Rig: ${result.error}`);
        return;
      }
      setRig(result);
    } catch {
      /* noop */
    }
  }, [setRig, position]);

  /* While armed, keep the rig anchored to the audio: it parks itself STALE_S
     (0.4s) after the last position it heard, so a show only follows playback if
     we re-post where we are. Responses are dropped on purpose — the 1s status
     poll owns the pill, and setting rig state at 7 Hz would re-render the whole
     editor for nothing. The interval is idle (one getState check) when disarmed. */
  useEffect(() => {
    const id = setInterval(() => {
      const st = usePortalStore.getState();
      if (st.rig?.armed && st.job)
        api.rig.at(st.job, heard()).catch(() => {});
    }, 100);
    return () => clearInterval(id);
  }, [heard]);

  /* ── the song's own show file, if the hub has one ──────────────────────────
     Authored show files are the point of the v2 baker, so one is loaded the
     moment its song is: it should not take a file picker to see the show that
     already exists for this track. Loaded once per song; placing a clip after
     that edits what was loaded rather than re-fetching over the top of it. */
  const loadedForRef = useRef<string | null>(null);
  /* Set when a plan has taken the initial bake for itself. The legacy seed+edits
     bake fires on the same song change, and whichever of the two landed second
     won — so opening a saved show showed its plan or the seed's arrangement
     depending on which round trip was slower. */
  const planBakesRef = useRef(false);
  const applyPlanRef = useRef(applyPlan);
  useEffect(() => {
    applyPlanRef.current = applyPlan;
  });
  useEffect(() => {
    if (!song || loadedForRef.current === song.name) return;
    const name = song.name;
    loadedForRef.current = name;
    planBakesRef.current = false;

    /* A show opened from the Shows list carries its own plan, and that plan IS
       the show. It has to beat the song's show file, which is per-song: without
       this, every saved show for one song opened as whatever that song's file
       happened to hold, and the edits restored from the record were overwritten
       a moment later by planToEdits on the wrong plan. */
    /* Not cleared here: resetForShow() owns that, and it runs before every open
       from the library and from the list — which are the only two ways the song
       changes. Clearing it from inside the effect would be a store write in an
       effect body to no one's benefit, since nothing renders off it. */
    const handed = usePortalStore.getState().pendingPlan;
    if (handed) {
      /* The flag is set NOW — the effect that would fire the legacy bake runs
         immediately after this one and reads it synchronously. The bake itself
         is deferred a microtask, because applyPlan sets state on its way in and
         the show-file path below only gets away with the same call by sitting
         inside a .then. */
      planBakesRef.current = true;
      queueMicrotask(() =>
        applyPlanRef.current(asPlan(handed as Record<string, unknown>), "saved show"),
      );
      return;
    }

    /* Claim the bake before going to the network. Without this the seed bake
       below also fires, bumps the rebuild token, and the show file's own bake
       is thrown away as stale - which is why opening a song from the library
       left the timeline empty while typing the same URL did not. */
    planBakesRef.current = true;
    api.showfile
      .get(name)
      .then((d) => {
        if (!d.showfile) {
          planBakesRef.current = false;
          setStageMsg("");
          return;
        }
        applyPlanRef.current(asPlan(d.showfile as Record<string, unknown>), "show file");
      })
      .catch(() => {
        /* no file for this song is the normal case; release the claim so the
           seed bake can still draw something */
        planBakesRef.current = false;
      });
  }, [song]);

  /* ── load audio + bake on song change ────────────────────────────────── */
  const rebuildRef = useRef(rebuild);
  useEffect(() => {
    rebuildRef.current = rebuild;
  });
  useEffect(() => {
    if (!song) return;
    load(song.name);
    /* The effect above runs first and may already have claimed the bake for a
       handed-over plan. Firing the seed+edits bake as well would only race it. */
    if (planBakesRef.current) return;
    const timer = setTimeout(() => rebuildRef.current(), 0);
    return () => clearTimeout(timer);
  }, [song, load]);

  /* ── playback toggle ─────────────────────────────────────────────────── */
  const handleToggle = useCallback(() => {
    toggle();
    setIsPlaying(playing());
  }, [toggle, playing]);


  const handleSeek = useCallback(
    (t: number) => {
      seek(clamp(t, 0, (show?.duration_s ?? 1) - 0.01));
      setCurrentTime(position());
    },
    [seek, show, position],
  );

  /* ── update current time ─────────────────────────────────────────────── */
  useAnimationLoop(() => {
    const t = position();
    setCurrentTime(t);
    setIsPlaying(playing());

    if (show) {
      let idx = -1;
      show.sections.forEach((s, j) => {
        if (t >= s.start && t < s.end) idx = j;
      });
      setSecIndex(idx);
    }
  }, true);

  /* ── keyboard shortcuts ──────────────────────────────────────────────── */
  /* Space lives here, in the one keyboard hook, and nowhere else. It was ALSO
     bound in the timeline and then again on this page, so two handlers toggled
     playback against each other on a single press and it looked like the key
     did nothing. */
  useKeyboardShortcuts({
    onSpace: handleToggle,
    onEscape: () => {
      if (arm) setArm(null);
      else if (sel >= 0) setSel(-1);
    },
    /* Delete is NOT handled here. The timeline owns the selection, and it
       removes what is selected; this used to remove the store's `sel` as well,
       so one press of ⌫ took two clips away — the one you meant and whichever
       was placed last. */
  });

  /* ── save ─────────────────────────────────────────────────────────────────
     ONE save, landing in two places, because the creator only ever meant one
     thing by it. Saving used to be two buttons: "Save plan" wrote the song's
     show file, "Save show" wrote a record — so the obvious button wrote a file
     that never appeared in Shows, and the show you had just saved was nowhere
     to be found.

     The plan is built once and written to both: the song's show file (what
     loads when you open the song by itself) and the show record (what Shows
     lists). The record carries the plan with it, so opening it from that list
     reconstructs this timeline rather than a bake of {seed, edits}. */
  const handleSave = useCallback(
    async (name: string) => {
      const st = usePortalStore.getState();
      if (!st.show || !st.song) return;
      setSaving(true);
      setSaveError(null);
      try {
        const plan = editsToPlan(st.edits, st.show, st.effects, st.planText);
        /* The show file is a convenience, not the record. A hub that will not take
         it must not cost the creator the save they actually asked for. */
        const filed = await api.showfile
          .save(st.song.name, plan)
          .catch(() => null);

        const d = await api.shows.save({
          id: st.showId,
          song: st.song.name,
          seed: st.seed,
          edits: st.edits,
          name,
          author: st.author || "unknown",
          appetite: st.want,
          score_version: st.song.version,
          plan,
          plan_text: st.planText,
          designed_for: st.room
            ? {
                venue_id: st.room.id,
                venue_name: st.room.name,
                layout: st.layout ?? undefined,
              }
            : null,
        });
        if (d.error) {
          setSaveError(d.error);
          return;
        }

        setShowId(d.id);
        setShowVersion(d.version);
        setSavedName(d.name ?? name);
        setSaveOpen(false);
        setStageMsg(
          `Saved \u201c${d.name ?? name}\u201d to Shows \u00b7 v${d.version}` +
            (filed?.cues !== undefined
              ? ` · ${filed.cues} cues in the show file`
              : ""),
        );
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Could not save. Check your connection and try again.");
      } finally {
        setSaving(false);
      }
    },
    [setShowId, setShowVersion],
  );

  /* The timeline and the effects panel both read these, so they live on the
     page rather than inside either one. */
  const [selection, setSelection] = useState<string[]>([]);

  /* A clip that has been taken over is not drawn: your version stands in its
     place, so showing both would just be the same effect twice. */
  const clips = useMemo(() => {
    if (!show) return [];
    /* One path, not two. A show file arrives as Edit[] through planToEdits, so
       by the time it gets here it is indistinguishable from a clip dropped from
       the palette — which is exactly what makes the file editable rather than
       just viewable. */
    return buildClips(show.plan ?? null, edits, effects, show.grid).filter(
      (c) => !c.overridden,
    );
  }, [show, edits, effects]);

  /* A reveal request brings a clip into view. The list that raised them is gone
     for now, but the timeline still honours them — the chat rail will want it. */
  const [reveal] = useState<{ key: string; n: number } | null>(null);
  const handleSelect = useCallback((key: string, additive: boolean) => {
    /* An empty key clears — the toolbar's × and Escape both use it. */
    setSelection((sel) =>
      key === ""
        ? []
        : additive
          ? sel.includes(key)
            ? sel.filter((k) => k !== key)
            : [...sel, key]
          : [key],
    );
  }, []);

  /* ── placing and removing effects ────────────────────────────────────────
     The clip appears the instant it is dropped; the lights catch up when the
     bake lands. Blocking the timeline on a 1-3s round trip would make placing
     feel broken even though nothing is wrong. */
  const handlePlace = useCallback(
    (edit: Edit | Edit[], displaced?: Map<number, number>): number[] => {
      const list = Array.isArray(edit) ? edit : [edit];
      if (!list.length) return [];
      /* Appended in ONE write, off the live list. A paste of four clips through
         addEdit would be four store writes and four rebakes of the same show,
         and the indices handed back would be stale by the second one. */
      const st = usePortalStore.getState();
      const at = st.edits.length;
      /* `displaced` is the clips that had to step down a lane to make room for
         this one — see displaceForInsert. They ride in the SAME write, so a
         drop that moves three other clips is still one undo step and one bake.
         Writing them separately first would take two presses of undo to put
         back what one press of the pointer did. */
      const base = displaced?.size
        ? st.edits.map((e, i) => (displaced.has(i) ? { ...e, layer: displaced.get(i) } : e))
        : st.edits;
      setEdits([...base, ...list], "push");
      setSel(at + list.length - 1);
      rebuild();
      return list.map((_, i) => at + i);
    },
    [setEdits, setSel, rebuild],
  );

  const handleRemove = useCallback(
    (index: number) => {
      removeEdit(index);
      rebuild();
    },
    [removeEdit, rebuild],
  );

  /* Dragging updates the edit locally on every pointer move so the clip tracks
     the cursor; the bake fires once, on release. Re-baking mid-drag would stall
     the gesture behind a 1-3s round trip for no benefit. */
  const handleUpdateLive = useCallback(
    (index: number, patch: Parameters<typeof updateEdit>[1]) =>
      /* All of them carry the same token, so the store records the state
         BEFORE the gesture once and nothing after it. Undo then takes back the
         drag, not the last pixel of it. */
      updateEdit(index, patch, LIVE),
    [updateEdit],
  );

  /* The gesture is over: bake what it produced, and close the undo step so the
     next drag of the same clip is a step of its own rather than more of this
     one. */
  const handleCommit = useCallback(() => {
    endEditGroup();
    rebuild();
  }, [endEditGroup, rebuild]);

  /* Stepping through history rebakes, because the lights are derived from the
     edits and a show that looks undone but still plays the old cues is worse
     than no undo at all. */
  const handleUndo = useCallback(() => {
    const before = usePortalStore.getState().edits;
    undo();
    if (usePortalStore.getState().edits === before) return false;
    setSelection([]);
    rebuild();
    return true;
  }, [undo, rebuild]);

  const handleRedo = useCallback(() => {
    const before = usePortalStore.getState().edits;
    redo();
    if (usePortalStore.getState().edits === before) return false;
    setSelection([]);
    rebuild();
    return true;
  }, [redo, rebuild]);

  /* Taking over one of the arranger's clips: copy what it does into an edit of
     your own at the same place. The machine's version stays on the timeline,
     struck through, so it is obvious what was replaced and where. */
  const handleMaterialize = useCallback(
    (clip: Clip): number | null => {
      /* Schema 1 tiles declared the plan's word as `fx`, so they matched it
         directly. Schema 2 tiles do not, so the plan's word is mapped onto a
         catalogue id — without this the lookup failed, materialising returned
         null, and the arranger's clips could not be moved or resized at all. */
      const tile = tileForClip(clip, effects);
      if (!tile) return null;
      /* Read the live count, not a closed-over one: two materialisations in the
         same tick would otherwise both claim the same index. */
      const index = usePortalStore.getState().edits.length;
      /* Record which assignment this replaces. Overlap alone could not carry it:
         moving your copy away let the machine's version play again underneath. */
      /* Under the gesture's own token: taking a clip over is the first half of
         the drag that took it over, so one undo takes back both rather than
         leaving a copy of the arranger's clip behind with nothing done to it. */
      addEdit({
        type: tile.id,
        bar: clip.bar,
        beat: clip.beat,
        beats: clip.beats,
        /* The lane it was already drawn on. An arranger's clip carries none of
           its own — the packer places it — so the timeline resolves that and
           passes it in. Without it the new edit would be drawn wherever the
           packer put it next while baking as though it sat on the top lane. */
        ...(typeof clip.layer === "number" ? { layer: clip.layer } : {}),
        ...(clip.planId ? { from: clip.planId } : {}),
      }, LIVE);
      return index;
    },
    [effects, addEdit],
  );

  /* The show file is written by handleSave, alongside the record Shows lists.
     The palette's drops are Edit[], and editsToPlan turns those back into the
     same states/bindings/gestures shape the file arrived in — so a cue placed by
     hand and a cue authored in the file are the same thing by the time they are
     saved. That is what makes the file the one source of truth rather than a
     read-only import. */

  /* ── venue picker ────────────────────────────────────────────────────── */
  const handlePickVenue = useCallback(
    (v: Venue, layoutFile: string) => {
      setRoom({
        id: v.id,
        name: v.name,
        layout: layoutFile,
        example: v.example,
      });
      setLayout(layoutFile);
      setVenuePickerOpen(false);
      rebuild();
    },
    [setRoom, setLayout, rebuild],
  );

  /* ── back button ─────────────────────────────────────────────────────── */
  const handleBack = useCallback(() => {
    pause();
    setIsPlaying(false);
    router.push(venue ? "/shows" : "/library");
  }, [pause, venue, router]);

  const liveRig = usePortalStore((s) => s.rig);
  /* Nowhere to send means the button has nothing to do: a primary action that
     fails the moment you press it is worse than one that says why it is off. */
  const rigOffline = !liveRig || !liveRig.can_send;
  const rigSending = !!liveRig?.sending;

  const isDesigner = role === "creator";
  const isOperator = role === "venue";
  const isBaking = stageMsg?.startsWith("Building");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const close = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [moreOpen]);

  return (
    <>
      <div className="flex flex-1 min-h-0 overflow-hidden bg-bg text-ink">
        {/* Both rails stay mounted in both roles, at the same widths. Swapping
            a whole rail in and out moved every column on the page, so changing
            role read as a navigation rather than as a change of view. Only the
            contents cross-fade. */}
        <div className="flex-none overflow-hidden" style={{ width: railW }}>
          <div key={role} className="h-full rail-swap">
            {isDesigner ? (
              <Sidebar effects={effects} onRecolour={handleRecolour} />
            ) : (
              <OperatorRail onPickRig={handlePickVenue} />
            )}
          </div>
        </div>
        <div
          onPointerDown={startRail("left")}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the left panel"
          className="flex-none w-[4px] cursor-col-resize border-x border-solid border-white/[0.04] hover:border-accent/25 hover:bg-accent/[0.05] transition-colors duration-200"
        />

        <div
          ref={columnRef}
          className="relative flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden"
        >
          <header className="liquid liquid-flush flex-none flex items-center gap-[12px] px-[16px] h-[50px] z-20">
            <button
              type="button"
              onClick={handleBack}
              className="liquid liquid-key flex items-center justify-center w-[30px] h-[30px] rounded-[var(--radius-sm)] text-ink-dim cursor-pointer hover:text-ink"
              title="Back to songs"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 12L6 8l4-4" />
              </svg>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-[10px]">
                <h1 className="text-[16px] font-semibold leading-[20px] truncate m-0 tracking-[-0.01em]">
                  {song?.title ?? "\u2014"}
                </h1>
                <span className="mono text-[11px] text-ink-dimmer tabular-nums flex-none">
                  {song
                    ? `${mmss(song.duration_s ?? 0)} \u00b7 ${Math.round(song.bpm ?? 0)} BPM` +
                      (show ? ` \u00b7 ${show.grid.bars} bars` : "")
                    : ""}
                </span>
              </div>
            </div>

            <RoleToggle />

            {isOperator && <RigControl onToggle={handleRigToggle} />}

            {isDesigner && (
              <>
                <Button
                  variant="ghost"
                  disabled={!song || generating}
                  onClick={handleGenerate}
                >
                  {generating ? "Generating\u2026" : "Generate"}
                </Button>

                <Button
                  variant="primary"
                  disabled={!show || !song}
                  onClick={() => {
                    setSaveError(null);
                    setSaveOpen(true);
                  }}
                >
                  {showId ? "Save" : "Save show"}
                </Button>

                <div className="relative" ref={moreRef}>
                  <button
                    type="button"
                    onClick={() => setMoreOpen(!moreOpen)}
                    className="liquid liquid-key flex items-center justify-center w-[30px] h-[30px] rounded-[var(--radius-sm)] text-ink-dim cursor-pointer hover:text-ink"
                    title="More actions"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <circle cx="8" cy="3.5" r="1.2" />
                      <circle cx="8" cy="8" r="1.2" />
                      <circle cx="8" cy="12.5" r="1.2" />
                    </svg>
                  </button>
                  {moreOpen && (
                    <div className="liquid absolute right-0 top-[calc(100%+6px)] z-50 w-[210px] rounded-[var(--radius-md)] py-[4px] animate-scale-in">
                      <input
                        ref={importInputRef}
                        type="file"
                        accept="application/json,.json"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.currentTarget.value = "";
                          if (f) importPlan(f);
                          setMoreOpen(false);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => { importInputRef.current?.click(); }}
                        className="block w-[calc(100%-8px)] mx-[4px] text-left px-[10px] py-[8px] border-0 bg-transparent text-[13px] text-ink-dim cursor-pointer hover:bg-white/[0.05] hover:text-ink transition-colors duration-150 rounded-[var(--radius-sm)]"
                      >
                        Import show file
                      </button>
                      <button
                        type="button"
                        disabled={!show || !song}
                        onClick={() => { handleDownload(); setMoreOpen(false); }}
                        className="block w-[calc(100%-8px)] mx-[4px] text-left px-[10px] py-[8px] border-0 bg-transparent text-[13px] text-ink-dim cursor-pointer hover:bg-white/[0.05] hover:text-ink transition-colors duration-150 rounded-[var(--radius-sm)] disabled:opacity-35 disabled:cursor-default"
                      >
                        Download show file
                      </button>
                    </div>
                  )}
                </div>

              </>
            )}

            {isOperator && (
              <Button
                variant="primary"
                disabled={!show || !song || rigOffline}
                onClick={handleRigToggle}
                title={
                  rigOffline
                    ? "The rig is not reachable, so there is nowhere to send to."
                    : rigSending
                      ? "Stop sending to the rig"
                      : "Start sending this show to the rig"
                }
              >
                {rigOffline ? "Rig offline" : rigSending ? "Stop sending" : "Go live"}
              </Button>
            )}
          </header>

          <div className="flex-none px-[16px] py-[4px]">
            <TargetLine onOpenVenuePicker={() => setVenuePickerOpen(true)} />
          </div>

          <div className="flex-1 min-h-0 flex flex-col">
            <StagePreview
              clockRef={clockRef}
              playing={isPlaying}
              currentTime={currentTime}
            />
          </div>

          {isBaking ? (
            <div className="flex-none px-[16px] py-[8px]">
              <div className="flex items-center gap-[10px]">
                <div className="flex-1 h-[2px] rounded-full bg-accent/10 overflow-hidden">
                  <div className="h-full w-[30%] rounded-full progress-indeterminate" style={{ background: "var(--grad-primary)" }} />
                </div>
                <span className="text-[11px] font-medium text-accent flex-none animate-pulse-bar">Building show…</span>
              </div>
            </div>
          ) : stageMsg ? (
            <div className="flex-none text-center text-[11px] text-ink-dim py-[6px]">
              {stageMsg}
            </div>
          ) : null}

          <div
            onPointerDown={startResize}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the editor"
            className="flex-none h-[4px] cursor-row-resize border-y border-solid border-white/[0.04] hover:border-accent/25 hover:bg-accent/[0.04] transition-all duration-200"
          />

          <section
            ref={editorRef}
            style={{ height: isOperator ? 300 : editorH, minHeight: MIN_EDITOR }}
            className="flex-initial overflow-hidden"
          >
            {isOperator ? (
              <OperatorConsole
                currentTime={currentTime}
                duration={show?.duration_s ?? song?.duration_s ?? 0}
                grid={show?.grid ?? null}
                playing={isPlaying}
                onToggle={handleToggle}
                onSeek={handleSeek}
              />
            ) : (
            <StageTimeline
              onNaturalHeight={fitEditor}
              onGenerate={song ? handleGenerate : undefined}
              generating={generating}
              show={show}
              energy={song?.energy ?? []}
              clips={clips}
              effects={effects}
              selection={selection}
              onSelect={handleSelect}
              currentTime={currentTime}
              playing={isPlaying}
              onSeek={handleSeek}
              onToggle={handleToggle}
              onPlace={handlePlace}
              onRemove={handleRemove}
              onUpdateLive={handleUpdateLive}
              onMaterialize={handleMaterialize}
              onCommit={handleCommit}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={canUndo}
              canRedo={canRedo}
              reveal={reveal}
              baking={stageMsg}
            />
            )}
          </section>

        </div>

        <div
          onPointerDown={startRail("right")}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the side panel"
          className="flex-none w-[4px] cursor-col-resize border-x border-solid border-white/[0.04] hover:border-accent/25 hover:bg-accent/[0.05] transition-colors duration-200"
        />

        <aside className="flex-none overflow-hidden" style={{ width: asideW }}>
          <div key={role} className="h-full rail-swap">
            {isOperator ? (
              <OperatorStatus
                clockRef={clockRef}
                playing={isPlaying}
                currentTime={currentTime}
              />
            ) : (
              <ChatPanel />
            )}
          </div>
        </aside>
      </div>

      <VenuePicker
        open={venuePickerOpen}
        onClose={() => setVenuePickerOpen(false)}
        onPick={handlePickVenue}
      />

      {saveOpen && (
        <SaveShowDialog
          initialName={savedName ?? venue?.name ?? ""}
          saving={saving}
          error={saveError}
          existing={!!showId}
          onCancel={() => {
            if (!saving) setSaveOpen(false);
          }}
          onSave={handleSave}
        />
      )}
    </>
  );
}
