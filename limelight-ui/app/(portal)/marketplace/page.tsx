"use client";

import { useEffect, useCallback } from "react";
import { usePortalStore } from "@/store/portal";
import * as api from "@/lib/api";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { ListForm } from "@/components/marketplace/ListForm";

export default function MarketplacePage() {
  const market = usePortalStore((s) => s.market);
  const setMarket = usePortalStore((s) => s.setMarket);
  const role = usePortalStore((s) => s.role);

  const fetchMarket = useCallback(() => {
    api.market.list().then((d) => setMarket(d.listings)).catch(() => {});
  }, [setMarket]);

  useEffect(() => {
    fetchMarket();
  }, [fetchMarket]);

  return (
    <div className="flex flex-col overflow-hidden flex-1">
      <div className="flex-none px-[var(--spacing-s6)] pt-[var(--spacing-s5)] pb-[var(--spacing-s4)] border-b border-solid border-line">
        <div className="display">Marketplace</div>
        <div className="label mt-[7px]">
          {market.length} listing{market.length === 1 ? "" : "s"}
        </div>
        <div className="muted mt-[var(--spacing-s2)]">
          Surface only — no payments or licences are exchanged yet.
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-[var(--spacing-s6)] pt-[var(--spacing-s5)] pb-[var(--spacing-s7)]">
        {role === "creator" && (
          <div className="mb-[var(--spacing-s5)]">
            <ListForm onListed={fetchMarket} />
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] gap-[var(--spacing-s4)]">
          {market.map((listing) => (
            <ListingCard key={listing.show_id} listing={listing} />
          ))}
        </div>
        {!market.length && (
          <div className="text-dim text-center py-[var(--spacing-s7)]">No listings yet</div>
        )}
      </div>
    </div>
  );
}
