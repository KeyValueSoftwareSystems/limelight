"use client";

import { useEffect, useCallback, useState } from "react";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ListForm } from "@/components/marketplace/ListForm";
import { Button, CardSkeleton } from "@/components/ui";
import { ListingDialog } from "@/components/marketplace/ListingDialog";
import type { MarketListing } from "@/lib/types";

export default function MarketplacePage() {
  const market = usePortalStore((s) => s.market);
  const setMarket = usePortalStore((s) => s.setMarket);
  const role = usePortalStore((s) => s.role);
  const [listing, setListing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<MarketListing | null>(null);
  const songs = usePortalStore((s) => s.songs);
  const setSongs = usePortalStore((s) => s.setSongs);

  useEffect(() => {
    if (songs.length) return;
    api.songs.list().then((d) => setSongs(d.songs)).catch(() => {});
  }, [songs.length, setSongs]);

  const fetchMarket = useCallback(() => {
    api.market
      .list()
      .then((d) => { setMarket(d.listings); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [setMarket]);

  useEffect(() => {
    fetchMarket();
  }, [fetchMarket]);

  return (
    <div className="flex flex-col overflow-hidden flex-1">
      <ListingDialog listing={open} onClose={() => setOpen(null)} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="liquid liquid-flush sticky top-0 z-30 px-[28px] pt-[20px] pb-[16px]">
          <div className="flex items-center gap-[20px] flex-wrap">
            <div className="min-w-0">
              <h1 className="text-[26px] font-semibold tracking-[-0.025em] m-0 leading-[1.15] text-ink">
                Marketplace
              </h1>
              <p className="text-[12.5px] text-ink-dimmer mt-[4px] m-0 leading-[1.3]">
                {market.length} listing{market.length === 1 ? "" : "s"}
                {" · "}
                shows other designers have published. No payments are exchanged yet.
              </p>
            </div>

            <span className="flex-1 min-w-[16px]" />

            {role === "creator" && (
              <Button variant="primary" onClick={() => setListing((v) => !v)}>
                {listing ? "Close" : "List a show"}
              </Button>
            )}
          </div>
        </div>

        <div className="px-[28px] pt-[18px] pb-[48px]">
          {role === "creator" && listing && (
            <div className="mb-[22px]">
              <ListForm onListed={() => { fetchMarket(); setListing(false); }} />
            </div>
          )}

          {!loaded ? (
            <CardSkeleton count={8} />
          ) : market.length > 0 ? (
            <div className="card-grid">
              {market.map((l, i) => (
                <div
                  key={l.show_id}
                  className="animate-in h-full"
                  style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
                >
                  <ListingCard
                    listing={l}
                    song={songs.find((s) => s.name === l.show.song)}
                    onOpen={setOpen}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-[92px]">
              <p className="text-[17px] font-semibold text-ink m-0">Nothing listed yet</p>
              <p className="text-[13px] text-ink-dim mt-[8px] mb-0 text-center max-w-[380px] leading-[1.6]">
                Publish a show here and any room running Limelight can pick it up.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
