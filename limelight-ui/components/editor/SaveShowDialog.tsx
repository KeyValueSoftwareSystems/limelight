"use client";

import { useEffect, useRef, useState } from "react";

import { Dialog } from "@/components/primitives/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

/* Naming a show is a decision, not a field to walk past.

   As a bare input in the header it sat between "Save plan" and "Save show"
   looking like one more toolbar control, so the usual outcome was pressing
   Save with it empty — and handleSave() returned silently on a blank name,
   which reads as the button being dead. Asked for at the moment of saving, the
   name is the one thing on screen, Enter commits it, and an empty one can say
   so instead of doing nothing. */

/* Mounted only while it is open (see the stage page), so `initialName` is read
   once, at the moment of opening, and there is no reset to keep in step. */
interface Props {
  /** The name this show already has, when saving over an existing one. */
  initialName: string;
  /** Set while the save is in flight, so the dialog cannot be double-submitted. */
  saving: boolean;
  error: string | null;
  /** True when this will bump an existing show rather than create one. */
  existing: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}

export function SaveShowDialog({
  initialName, saving, error, existing, onCancel, onSave,
}: Props) {
  const [name, setName] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Focus is a DOM concern, not state: put the caret in the field and select
     what is there, so typing replaces the old name rather than appending to it.
     A frame late because the dialog mounts into the tree on this same commit. */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const trimmed = name.trim();
  const blank = trimmed.length === 0;

  const submit = () => {
    setTouched(true);
    if (blank || saving) return;
    onSave(trimmed);
  };

  return (
    <Dialog
      open
      title={existing ? "Save show" : "Name this show"}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={saving || blank}>
            {saving ? "Saving…" : existing ? "Save version" : "Save show"}
          </Button>
        </>
      }
    >
      <label className="label block mb-[var(--spacing-s2)]" htmlFor="show-name">
        Show name
      </label>
      <Input
        id="show-name"
        ref={inputRef}
        wide
        autoComplete="off"
        placeholder="e.g. Warehouse opener"
        value={name}
        disabled={saving}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        className="w-full"
      />

      <p className="mt-[var(--spacing-s3)] text-[length:var(--text-xs)] text-ink-dim">
        {existing
          ? "Saved as a new version of this show. It stays at the top of Shows."
          : "Saved to Shows, with the plan, so it opens back into this timeline."}
      </p>

      {touched && blank && !error && (
        <p className="mt-[var(--spacing-s2)] text-[length:var(--text-xs)] text-warn">
          Give the show a name first.
        </p>
      )}
      {error && (
        <p className="mt-[var(--spacing-s2)] text-[length:var(--text-xs)] text-danger">{error}</p>
      )}
    </Dialog>
  );
}
