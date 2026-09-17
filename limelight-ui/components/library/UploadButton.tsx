"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Check, AlertCircle, Loader2 } from "lucide-react";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";

type Phase = "idle" | "uploading" | "generating" | "done" | "error";

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued\u2026",
  generating: "Analysing\u2026",
  storing: "Storing\u2026",
};

/* The hub reports a phase, never a percentage, so the bar is honest about what
   it knows: the upload's real byte progress, then one step per phase the hub
   actually names. The filled portion keeps a slow shimmer while a phase is
   running, which says "working" without inventing a number. */
const PHASE_AT: Record<string, number> = {
  queued: 0.42,
  generating: 0.58,
  storing: 0.88,
  done: 1,
};

function trackProgress(uploaded: number, status: string | null): number {
  if (!status) return uploaded * 0.38;
  return PHASE_AT[status] ?? 0.5;
}

export function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const statusRef = useRef<string | null>(null);
  const [genLabel, setGenLabel] = useState("Queued\u2026");
  const [errorMsg, setErrorMsg] = useState("");
  const jobRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setSongs = usePortalStore((s) => s.setSongs);

  const cleanup = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    jobRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setPhase("idle");
    setProgress(0);
    setGenLabel("Queued\u2026");
    setErrorMsg("");
    if (inputRef.current) inputRef.current.value = "";
  }, [cleanup]);

  const fail = useCallback((msg: string) => {
    cleanup();
    setPhase("error");
    setErrorMsg(msg);
  }, [cleanup]);

  const startPolling = useCallback((jobId: string) => {
    jobRef.current = jobId;
    setPhase("generating");
    setGenLabel("Queued\u2026");

    pollRef.current = setInterval(async () => {
      try {
        const st = await api.upload.status(jobId);
        statusRef.current = st.status;
        setGenLabel(STATUS_LABELS[st.status] ?? st.status);
        if (st.status === "done") {
          cleanup();
          setPhase("done");
          try { const d = await api.songs.list(true); setSongs(d.songs); } catch {}
          setTimeout(reset, 2500);
        } else if (st.status === "error") {
          fail(st.error ?? "Score generation failed.");
        }
      } catch {
        fail("Connection lost.");
      }
    }, 1500);
  }, [cleanup, reset, fail, setSongs]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".mp3")) {
      fail("Only MP3 files are supported.");
      return;
    }
    setPhase("uploading");
    setProgress(0);
    try {
      const res = await api.upload.send(file, (pct) => setProgress(pct));
      startPolling(res.job_id);
    } catch (err) {
      fail(err instanceof api.ApiError ? err.message : "Upload failed.");
    }
  }, [fail, startPolling]);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  if (phase === "idle") {
    return (
      <>
        <input ref={inputRef} type="file" accept=".mp3,audio/mpeg" className="hidden" onChange={onInputChange} />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="liquid liquid-key flex items-center gap-[7px] h-[var(--control-h)] px-[16px] rounded-[var(--radius-sm)] text-[13px] font-semibold cursor-pointer"
        >
          <Upload size={14} strokeWidth={2.5} />
          Upload track
        </button>
      </>
    );
  }

  if (phase === "uploading" || phase === "generating") {
    const working = phase === "generating";
    const frac = trackProgress(progress, working ? statusRef.current : null);
    const pct = Math.round(frac * 100);
    const label = working ? genLabel : "Uploading\u2026";
    return (
      <div className="flex items-center gap-[10px] min-w-[230px]">
        <input ref={inputRef} type="file" accept=".mp3,audio/mpeg" className="hidden" onChange={onInputChange} />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-[5px]">
            <span className="flex items-center gap-[6px] text-[11px] font-medium text-ink-dim">
              {working && <Loader2 size={11} className="animate-spin flex-none" />}
              {label}
            </span>
            <span className="mono text-[11px] text-ink-dimmer tabular-nums">{pct}%</span>
          </div>
          <div className="liquid-well h-[5px] w-full rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out)] ${
                working ? "progress-working" : ""
              }`}
              style={{ width: `${Math.max(3, pct)}%`, background: "var(--accent)" }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex items-center gap-[7px] animate-in">
        <input ref={inputRef} type="file" accept=".mp3,audio/mpeg" className="hidden" onChange={onInputChange} />
        <div className="w-[20px] h-[20px] rounded-full bg-ok/20 flex items-center justify-center">
          <Check size={12} className="text-ok" strokeWidth={2.5} />
        </div>
        <span className="text-[12px] font-semibold text-ok">Ready</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-[8px]">
      <input ref={inputRef} type="file" accept=".mp3,audio/mpeg" className="hidden" onChange={onInputChange} />
      <AlertCircle size={13} className="text-danger flex-none" />
      <span className="text-[12px] text-danger max-w-[160px] truncate" title={errorMsg}>{errorMsg}</span>
      <button
        type="button"
        onClick={reset}
        className="text-[12px] font-medium text-ink-dim border-0 bg-transparent cursor-pointer hover:text-ink transition-colors px-[6px]"
      >
        Retry
      </button>
    </div>
  );
}
