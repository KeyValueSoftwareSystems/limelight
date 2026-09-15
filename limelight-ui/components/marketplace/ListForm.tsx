"use client";

import { useState, useCallback, useEffect } from "react";
import * as api from "@/lib/api";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import type { ShowFile } from "@/lib/types";

interface ListFormProps {
  onListed: () => void;
}

export function ListForm({ onListed }: ListFormProps) {
  const [shows, setShows] = useState<ShowFile[]>([]);
  const [selectedShowId, setSelectedShowId] = useState("");
  const [tier, setTier] = useState("free");
  const [blurb, setBlurb] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.shows.list().then((d) => setShows(d.shows)).catch(() => {});
  }, []);

  const handleList = useCallback(async () => {
    if (!selectedShowId) return;
    setSubmitting(true);
    try {
      await api.market.put({ show_id: selectedShowId, tier, blurb });
      onListed();
    } catch { /* noop */ }
    setSubmitting(false);
  }, [selectedShowId, tier, blurb, onListed]);

  return (
    <div className="flex flex-col gap-[var(--spacing-s3)] p-[var(--spacing-s5)] border border-solid border-line rounded-lg bg-panel">
      <div className="label">List a show</div>
      <Select value={selectedShowId} onChange={(e) => setSelectedShowId(e.target.value)}>
        <option value="">Pick a show</option>
        {shows.map((sf) => (
          <option key={sf.id} value={sf.id}>
            {sf.name} — {sf.song}
          </option>
        ))}
      </Select>
      <Select value={tier} onChange={(e) => setTier(e.target.value)}>
        <option value="free">Free</option>
        <option value="paid">Paid</option>
      </Select>
      <Input
        placeholder="Why should someone play your show?"
        value={blurb}
        onChange={(e) => setBlurb(e.target.value)}
      />
      <Button variant="big" onClick={handleList} disabled={!selectedShowId || submitting}>
        {submitting ? "Listing…" : "List"}
      </Button>
    </div>
  );
}
