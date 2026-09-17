"use client";

import { useRef, useCallback, useEffect } from "react";
import type { AnchoredClock } from "./useAnchoredClock";
import { audioUrl } from "@/lib/api";
import { outputLatencyOf } from "@/lib/sync";
import { usePortalStore } from "@/store/portal";

/* Sample-accurate playback, and a clock that cannot disagree with the sound.

   The previous player was an <audio> element read through audio.currentTime.
   That number is the decoder's estimate of where it is, and for an mp3 whose
   header does not match its frames (this one declares 64 kbps and is 128) the
   estimate is wrong after every seek -- by a different amount each time. So a
   show that lined up on the first play landed somewhere else on the second,
   which is what "the lights drift between plays" was.

   Here the whole file is decoded once into an AudioBuffer (the decoder walks
   every frame, so the buffer IS the sound, sample for sample) and played from
   an AudioBufferSourceNode started at a known engine time. Position is then
   arithmetic on the engine's own clock: offset + (now - startedAt). Nothing is
   estimated; a seek is exact; two plays land in the same place. */
class BufferPlayer implements AnchoredClock {
  private ctx: AudioContext;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private offset = 0;       // song position at the last start / pause / seek
  private startedAt = 0;    // engine time the current source began sounding
  private _playing = false;
  private pendingPlay = false;
  private loadId = 0;
  private onLatency: (s: number) => void;

  constructor(ctx: AudioContext, onLatency: (s: number) => void) {
    this.ctx = ctx;
    this.onLatency = onLatency;
  }

  duration(): number { return this.buffer ? this.buffer.duration : 0; }

  get playing(): boolean { return this._playing; }

  position(): number {
    if (!this._playing) return this.offset;
    const t = this.offset + Math.max(0, this.ctx.currentTime - this.startedAt);
    return this.buffer ? Math.min(t, this.buffer.duration) : t;
  }

  async load(url: string): Promise<void> {
    const id = ++this.loadId;
    this.stopSource();
    this._playing = false;
    this.offset = 0;
    this.buffer = null;
    const bytes = await (await fetch(url)).arrayBuffer();
    const buf = await this.ctx.decodeAudioData(bytes);
    if (id !== this.loadId) return;          // a newer load has taken over
    this.buffer = buf;
    if (this.pendingPlay) { this.pendingPlay = false; this.play(); }
  }

  play(at?: number): void {
    if (at !== undefined) this.offset = Math.max(0, at);
    if (!this.buffer) { this.pendingPlay = true; return; }
    if (this.offset >= this.buffer.duration - 0.005) this.offset = 0;
    void this.ctx.resume();
    this.stopSource();
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffer;
    s.connect(this.ctx.destination);
    /* start a hair in the future so `startedAt` is the moment the first sample
       actually leaves the graph, not "sometime after this call returns" */
    const when = this.ctx.currentTime + 0.02;
    s.start(when, this.offset);
    this.startedAt = when;
    this.source = s;
    this._playing = true;
    s.onended = () => {
      if (this.source !== s) return;         // superseded by a pause/seek, not the end of the song
      this.offset = this.buffer ? this.buffer.duration : this.position();
      this._playing = false;
      this.source = null;
    };
    this.reportLatency();
  }

  pause(): void {
    if (this._playing) this.offset = this.position();
    this.stopSource();
    this._playing = false;
    this.pendingPlay = false;
  }

  seek(t: number): void {
    const was = this._playing;
    if (was) this.pause();
    this.offset = Math.max(0, Math.min(t, this.buffer ? this.buffer.duration : t));
    if (was) this.play();
  }

  reportLatency(): void {
    const l = outputLatencyOf(this.ctx);
    if (l > 0) this.onLatency(l);
  }

  private stopSource(): void {
    const s = this.source;
    this.source = null;
    if (s) { try { s.stop(); } catch { /* already stopped */ } s.disconnect(); }
  }

  close(): void { this.stopSource(); try { void this.ctx.close(); } catch { /* gone */ } }
}

/**
 * Manages the player. Same surface as before -- load, play, pause, seek,
 * toggle, position, playing -- so the stage page did not have to change.
 */
export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);   // kept for callers that still expect it; always null now
  const clockRef = useRef<AnchoredClock | null>(null);
  const playerRef = useRef<BufferPlayer | null>(null);

  useEffect(() => {
    let player: BufferPlayer | null = null;
    try {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor({ latencyHint: "interactive" });
        player = new BufferPlayer(ctx, (l) => usePortalStore.getState().setSyncLatency(l));
        playerRef.current = player;
        clockRef.current = player;
        /* outputLatency settles once the graph is running; ask again now and then */
        const id = setInterval(() => player?.reportLatency(), 1000);
        return () => { clearInterval(id); player?.close(); playerRef.current = null; clockRef.current = null; };
      }
    } catch { /* no audio device: position stays 0, the page still works */ }
    return undefined;
  }, []);

  const load = useCallback((songName: string) => {
    void playerRef.current?.load(audioUrl(songName));
  }, []);

  const play = useCallback(() => { playerRef.current?.play(); }, []);
  const pause = useCallback(() => { playerRef.current?.pause(); }, []);
  const seek = useCallback((t: number) => { playerRef.current?.seek(t); }, []);
  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) p.pause(); else p.play();
  }, []);
  const position = useCallback(() => playerRef.current?.position() ?? 0, []);
  const playing = useCallback(() => playerRef.current?.playing ?? false, []);

  return { audioRef, clockRef, load, play, pause, seek, toggle, position, playing };
}
