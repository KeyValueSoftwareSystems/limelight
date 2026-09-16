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
  RecolourResponse,
  Entitlement,
  TrimState,
  UploadResponse,
  UploadStatus,
} from "./types";

/* Empty means SAME ORIGIN. The portal and this page are served from one
   address, so the normal case is a relative path -- hence `??`, not `||`:
   an empty string is a deliberate choice and must not fall through to a
   hard-coded port. Set NEXT_PUBLIC_API_URL only to aim at a portal that is
   genuinely somewhere else. */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

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

export const showfile = {
  /** A hand-authored show file for this song, or null where there is none. */
  get(song: string): Promise<{ showfile: unknown | null }> {
    return request(`/api/showfile?song=${encodeURIComponent(song)}`);
  },

  /** Write the plan back to this song's show file. */
  save(song: string, plan: unknown): Promise<{ saved?: string; cues?: number; error?: string }> {
    return post("/api/showfile", { song, plan });
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

/* ── recolouring a show ──────────────────────────────────────────────────────
   portal/recolour.py. Hand it the show as it stands and the palette you want,
   and it derives the palette the show is CURRENTLY using — its declared one, or
   the colours its cues add up to — maps old entries onto new ones positionally,
   and rewrites every colour value in the plan. Nothing else moves: effects,
   timing, amounts, extents and the why text all come back untouched.

   `mapping` is its account of what it did, one entry per substitution. */

export const recolour = {
  apply(
    show: unknown,
    palette: { name: string; rgb: [number, number, number] }[],
  ): Promise<RecolourResponse> {
    return post<RecolourResponse>("/api/recolour", { show, palette });
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

export const upload = {
  send(
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<UploadResponse> {
    const form = new FormData();
    form.append("file", file);
    return new Promise<UploadResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
      });
      xhr.addEventListener("load", () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(data as UploadResponse);
          } else {
            reject(new ApiError(xhr.status, data.error || "upload failed"));
          }
        } catch {
          reject(new ApiError(xhr.status, "invalid response"));
        }
      });
      xhr.addEventListener("error", () =>
        reject(new ApiError(0, "network error during upload")),
      );
      xhr.addEventListener("abort", () =>
        reject(new ApiError(0, "upload cancelled")),
      );
      xhr.open("POST", `${BASE}/api/upload`);
      xhr.send(form);
    });
  },

  status(jobId: string): Promise<UploadStatus> {
    return request<UploadStatus>(
      `/api/upload/status?job=${encodeURIComponent(jobId)}`,
    );
  },
};

export function audioUrl(songName: string): string {
  return `${BASE}/audio/${encodeURIComponent(songName)}`;
}

export function coverUrl(file: string): string {
  return `${BASE}/covers/${file}`;
}

export { ApiError, BASE };
