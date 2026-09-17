"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Check, AlertCircle, Loader2 } from "lucide-react";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";

type Phase = "idle" | "uploading" | "generating" | "done" | "error";

const STATUS_LABELS: Record<string, string> = {
  queued: "Queued…",
  generating: "Analysing track…",
  storing: "Storing…",
};

export function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [genLabel, setGenLabel] = useState("Queued…");
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
    setGenLabel("Queued…");
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
    setGenLabel("Queued…");

    pollRef.current = setInterval(async () => {
      try {
        const st = await api.upload.status(jobId);
        setGenLabel(STATUS_LABELS[st.status] ?? st.status);
        if (st.status === "done") {
          cleanup();
          setPhase("done");
          try { const d = await api.songs.list(true); setSongs(d.songs); } catch {}
          setTimeout(reset, 2500);
        } else if (st.status === "error") {
          fail(st.error ?? "Score generation failed");
        }
      } catch {
        fail("Lost connection");
      }
    }, 1500);
  }, [cleanup, reset, fail, setSongs]);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".mp3")) {
      fail("Only .mp3 files are accepted");
      return;
    }
    setPhase("uploading");
    setProgress(0);
    try {
      const res = await api.upload.send(file, (pct) => setProgress(pct));
      startPolling(res.job_id);
    } catch (err) {
      fail(err instanceof api.ApiError ? err.message : "Upload failed");
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
          className="flex items-center gap-[7px] h-[36px] px-[16px] rounded-[var(--radius-sm)] border-0 text-[13px] font-semibold text-[#0C0D12] cursor-pointer hover:brightness-110 active:scale-[0.97] transition-all duration-200"
          style={{
            background: "linear-gradient(180deg, #FBBF24 0%, #F59E0B 100%)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.2)",
          }}
        >
          <Upload size={14} strokeWidth={2.5} />
          Add a song
        </button>
      </>
    );
  }

  if (phase === "uploading") {
    const pct = Math.round(progress * 100);
    return (
      <div className="flex items-center gap-[10px] min-w-[180px]">
        <input ref={inputRef} type="file" accept=".mp3,audio/mpeg" className="hidden" onChange={onInputChange} />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-[4px]">
            <span className="text-[11px] font-medium text-ink-dim">Uploading…</span>
            <span className="mono text-[11px] text-ink-dimmer tabular-nums">{pct}%</span>
          </div>
          <div className="h-[3px] w-full rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-200 ease-[var(--ease-out)]"
              style={{ width: `${pct}%`, background: "linear-gradient(90deg, #F59E0B, #FBBF24)" }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (phase === "generating") {
    return (
      <div className="flex items-center gap-[8px] min-w-[180px]">
        <input ref={inputRef} type="file" accept=".mp3,audio/mpeg" className="hidden" onChange={onInputChange} />
        <Loader2 size={14} className="text-accent animate-spin flex-none" />
        <span className="text-[12px] font-medium text-ink-dim">{genLabel}</span>
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
        Try again
      </button>
    </div>
  );
}
