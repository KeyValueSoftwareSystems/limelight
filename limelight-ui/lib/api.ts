import type {
  SongsResponse,
  BakeRequest,
  BakeResponse,
  ShowStatus,
  EffectsResponse,
  VenuesResponse,
  LayoutsResponse,
  LimitsSummary,
  RigStatus,
  ShowsResponse,
  SaveShowRequest,
  ShowFile,
  MarketResponse,
  ListShowRequest,
  ColoursResponse,
  Entitlement,
  TrimState,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8800";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}${path}`;
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

async function requestBytes(path: string): Promise<ArrayBuffer> {
  const url = `${BASE}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new ApiError(res.status, res.statusText);
  }
  return res.arrayBuffer();
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ── grouped endpoints ───────────────────────────────────────────────────── */

export const songs = {
  list(refresh = false): Promise<SongsResponse> {
    return request<SongsResponse>(`/api/songs${refresh ? "?refresh=1" : ""}`);
  },
};

export const show = {
  bake(req: BakeRequest): Promise<BakeResponse> {
    return post<BakeResponse>("/api/show", req);
  },

  status(job: string): Promise<ShowStatus> {
    return request<ShowStatus>(`/api/show?job=${job}`);
  },

  async frames(url: string): Promise<Uint8Array> {
    const buf = await requestBytes(url);
    return new Uint8Array(buf);
  },
};

/* ── v2 plan pipeline (portal composer + baker) ──────────────────────────────
   compose asks the model for a plan; plan.bake renders a plan (ours or one the
   creator edited) to frames. Both return through the SAME job/status/frames
   loop as the legacy bake, so `show.status` / `show.frames` are reused as-is. */
export const compose = {
  run(song: string, model?: string): Promise<{ plan: unknown; report?: unknown; saved?: string; error?: string }> {
    return post("/api/compose", { song, ...(model ? { model } : {}) });
  },
};

export const plan = {
  bake(song: string, planData: unknown, rig?: string): Promise<BakeResponse> {
    return post<BakeResponse>("/api/bake-plan", { song, plan: planData, ...(rig ? { rig } : {}) });
  },
};

export const effects = {
  list(): Promise<EffectsResponse> {
    return request<EffectsResponse>("/api/effects");
  },

  save(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return post<Record<string, unknown>>("/api/effects", body);
  },

  delete(id: string): Promise<{ deleted: string }> {
    return post<{ deleted: string }>("/api/effects", { delete: id });
  },
};

export const venues = {
  search(q = ""): Promise<VenuesResponse> {
    return request<VenuesResponse>(`/api/venues?q=${encodeURIComponent(q)}`);
  },

  use(venueId: string): Promise<{ ok: boolean; why?: string; note?: string; locked?: boolean }> {
    return post("/api/venue/use", { venue_id: venueId });
  },
};

export const layouts = {
  list(): Promise<LayoutsResponse> {
    return request<LayoutsResponse>("/api/layouts");
  },
};

export const colours = {
  get(song: string): Promise<ColoursResponse> {
    return request<ColoursResponse>(`/api/colours?song=${encodeURIComponent(song)}`);
  },

  set(song: string, who: string, colourNames: string[]): Promise<{ ok: boolean; code?: number; error?: string; who?: string }> {
    return post("/api/colours", { song, who, colours: colourNames });
  },
};

export const limits = {
  get(): Promise<LimitsSummary> {
    return request<LimitsSummary>("/api/limits");
  },
};

export const rig = {
  status(): Promise<RigStatus> {
    return request<RigStatus>("/api/rig");
  },

  arm(armed: boolean): Promise<RigStatus & { error?: string }> {
    return post("/api/rig", { armed });
  },

  trim(trims: TrimState): Promise<RigStatus> {
    return post<RigStatus>("/api/rig/trim", trims);
  },

  at(job: string, position: number): Promise<RigStatus> {
    return post<RigStatus>("/api/rig/at", { job, position });
  },

  swap(job: string, at: number): Promise<{ swap_at?: number; job?: string; error?: string }> {
    return post("/api/rig/swap", { job, at });
  },
};

export const shows = {
  list(): Promise<ShowsResponse> {
    return request<ShowsResponse>("/api/shows");
  },

  save(body: SaveShowRequest): Promise<ShowFile & { error?: string }> {
    return post("/api/shows", body);
  },
};

export const market = {
  list(): Promise<MarketResponse> {
    return request<MarketResponse>("/api/market");
  },

  put(body: ListShowRequest): Promise<Record<string, unknown>> {
    return post("/api/market", body);
  },
};

export const entitlement = {
  check(showId: string, tier: string): Promise<Entitlement> {
    return post<Entitlement>("/api/entitlement", { show_id: showId, tier });
  },
};

export function audioUrl(songName: string): string {
  return `${BASE}/audio/${encodeURIComponent(songName)}`;
}

export function coverUrl(file: string): string {
  return `${BASE}/covers/${file}`;
}

export { ApiError, BASE };
