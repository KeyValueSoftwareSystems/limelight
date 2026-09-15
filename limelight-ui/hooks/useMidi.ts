"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { TrimState } from "@/lib/types";

interface MidiMap {
  master: number[];
  par: number[];
  head: number[];
  howMuch: number[];
}

const DEFAULT_MIDI_MAP: MidiMap = {
  master: [0, 7],
  par: [1, 8],
  head: [2, 9],
  howMuch: [3, 10],
};

interface UseMidiOptions {
  onTrim: (patch: Partial<TrimState>) => void;
  onHowMuch?: (value: number) => void;
  midiMap?: MidiMap;
}

export function useMidi({ onTrim, onHowMuch, midiMap = DEFAULT_MIDI_MAP }: UseMidiOptions) {
  const [status, setStatus] = useState(() =>
    typeof navigator !== "undefined" && !navigator.requestMIDIAccess
      ? "no fader board: this browser has no Web MIDI"
      : "initialising\u2026",
  );
  const [devices, setDevices] = useState<string[]>([]);
  const accessRef = useRef<MIDIAccess | null>(null);
  const onTrimRef = useRef(onTrim);
  const onHowMuchRef = useRef(onHowMuch);

  useEffect(() => {
    onTrimRef.current = onTrim;
    onHowMuchRef.current = onHowMuch;
  });

  const handleMessage = useCallback(
    (e: MIDIMessageEvent) => {
      const [statusByte, cc, val] = e.data as unknown as [number, number, number];
      if ((statusByte & 0xf0) !== 0xb0) return;
      const v = val / 127;

      if (midiMap.master.includes(cc)) return onTrimRef.current({ master: v });
      if (midiMap.par.includes(cc)) return onTrimRef.current({ par: v });
      if (midiMap.head.includes(cc)) return onTrimRef.current({ head: v });
      if (midiMap.howMuch.includes(cc)) return onHowMuchRef.current?.(v);
    },
    [midiMap],
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.requestMIDIAccess) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        if (cancelled) return;
        accessRef.current = access;

        const attach = () => {
          const names: string[] = [];
          for (const input of access.inputs.values()) {
            names.push(input.name || "unknown");
            input.onmidimessage = handleMessage;
          }
          setDevices(names);
          setStatus(
            names.length
              ? `fader board: ${names.join(", ")} \u2014 CC 0-3 map to master/pars/heads/how-much`
              : "no fader board plugged in",
          );
        };

        access.onstatechange = attach;
        attach();
      } catch (e: unknown) {
        const err = e as { name?: string };
        setStatus(`no fader board: MIDI access refused (${err.name ?? "unknown"})`);
      }
    })();

    return () => {
      cancelled = true;
      if (accessRef.current) {
        for (const input of accessRef.current.inputs.values()) {
          input.onmidimessage = null;
        }
      }
    };
  }, [handleMessage]);

  return { status, devices };
}
