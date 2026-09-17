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
    <div className="panel flex flex-col gap-[12px] p-[18px] rounded-[var(--radius-lg)] max-w-[760px]">
      <div className="text-[13px] font-medium text-ink">List a show</div>
      <Select value={selectedShowId} onChange={(e) => setSelectedShowId(e.target.value)} aria-label="Show to list">
        <option value="">Pick a show</option>
        {shows.map((sf) => (
          <option key={sf.id} value={sf.id}>
            {sf.name} — {sf.song}
          </option>
        ))}
      </Select>
      <Select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Price">
        <option value="free">Free</option>
        <option value="paid">Paid</option>
      </Select>
      <Input
        placeholder="Why should someone play your show?"
        value={blurb}
        onChange={(e) => setBlurb(e.target.value)}
      />
      <div className="flex">
        <Button variant="big" onClick={handleList} disabled={!selectedShowId || submitting}>
          {submitting ? "Listing…" : "List this show"}
        </Button>
      </div>
    </div>
  );
}
