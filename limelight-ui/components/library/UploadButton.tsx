"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";

type Phase =
  | "idle"
  | "uploading"
  | "generating"
  | "done"
  | "error";

const STATUS_LABELS: Record<string, string> = {
  queued: "queued\u2026",
  generating: "analysing the track\u2026",
  storing: "storing\u2026",
};

export function UploadButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [genLabel, setGenLabel] = useState("queued\u2026");
  const [errorMsg, setErrorMsg] = useState("");
  const jobRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const setSongs = usePortalStore((s) => s.setSongs);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    jobRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setPhase("idle");
    setProgress(0);
    setGenLabel("queued\u2026");
    setErrorMsg("");
    if (inputRef.current) inputRef.current.value = "";
  }, [cleanup]);

  const fail = useCallback(
    (msg: string) => {
      cleanup();
      setPhase("error");
      setErrorMsg(msg);
    },
    [cleanup],
  );

  const startPolling = useCallback(
    (jobId: string) => {
      jobRef.current = jobId;
      setPhase("generating");
      setGenLabel("queued\u2026");

      pollRef.current = setInterval(async () => {
        try {
          const st = await api.upload.status(jobId);
          setGenLabel(STATUS_LABELS[st.status] ?? st.status);

          if (st.status === "done") {
            cleanup();
            setPhase("done");
            try {
              const d = await api.songs.list(true);
              setSongs(d.songs);
            } catch { /* library will refresh on next visit */ }
            setTimeout(reset, 2000);
          } else if (st.status === "error") {
            fail(st.error ?? "score generation failed");
          }
        } catch {
          fail("lost connection while waiting for score");
        }
      }, 1500);
    },
    [cleanup, reset, fail, setSongs],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".mp3")) {
        fail("only .mp3 files are accepted");
        return;
      }
      setPhase("uploading");
      setProgress(0);

      try {
        const res = await api.upload.send(file, (pct) =>
          setProgress(pct),
        );
        startPolling(res.job_id);
      } catch (err) {
        fail(
          err instanceof api.ApiError
            ? err.message
            : "upload failed",
        );
      }
    },
    [fail, startPolling],
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  /* ── idle ── */
  if (phase === "idle") {
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,audio/mpeg"
          className="hidden"
          onChange={onInputChange}
        />
        <Button variant="big" onClick={openPicker}>
          <span className="flex items-center gap-[6px]">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M7 1v9M3.5 4L7 1l3.5 3M2 10.5v1.5h10v-1.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Upload MP3
          </span>
        </Button>
      </>
    );
  }

  /* ── uploading ── */
  if (phase === "uploading") {
    const pct = Math.round(progress * 100);
    return (
      <div className="flex items-center gap-[var(--spacing-s2)] min-w-[160px]">
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,audio/mpeg"
          className="hidden"
          onChange={onInputChange}
        />
        <div className="flex-1 flex flex-col gap-[4px]">
          <span className="label">uploading\u2026 {pct}%</span>
          <div className="h-[4px] w-full rounded-full bg-bg-raised overflow-hidden">
            <div
              className="h-full rounded-full bg-accent"
              style={{
                width: `${pct}%`,
                transition: "width var(--dur-state) var(--ease)",
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  /* ── generating ── */
  if (phase === "generating") {
    return (
      <div className="flex items-center gap-[var(--spacing-s2)] min-w-[160px]">
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,audio/mpeg"
          className="hidden"
          onChange={onInputChange}
        />
        <div className="flex-1 flex flex-col gap-[4px]">
          <span className="label">{genLabel}</span>
          <div className="h-[4px] w-full rounded-full bg-bg-raised overflow-hidden">
            <div
              className="h-full rounded-full bg-accent animate-pulse-bar"
              style={{ width: "100%" }}
            />
          </div>
        </div>
      </div>
    );
  }

  /* ── done ── */
  if (phase === "done") {
    return (
      <div className="flex items-center gap-[6px] min-w-[160px]">
        <input
          ref={inputRef}
          type="file"
          accept=".mp3,audio/mpeg"
          className="hidden"
          onChange={onInputChange}
        />
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M2.5 7.5L5.5 10.5L11.5 3.5"
            stroke="var(--ok)"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="label" style={{ color: "var(--ok)" }}>
          ready
        </span>
      </div>
    );
  }

  /* ── error ── */
  return (
    <div className="flex items-center gap-[var(--spacing-s2)] min-w-[160px]">
      <input
        ref={inputRef}
        type="file"
        accept=".mp3,audio/mpeg"
        className="hidden"
        onChange={onInputChange}
      />
      <span
        className="text-[length:var(--text-xs)] tracking-[0.14em] uppercase max-w-[180px] truncate"
        style={{ color: "var(--danger)" }}
        title={errorMsg}
      >
        {errorMsg}
      </span>
      <Button variant="default" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
