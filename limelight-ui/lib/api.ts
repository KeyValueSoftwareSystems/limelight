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
  PaletteResponse,
  PaletteColour,
  Entitlement,
  TrimState,
  UploadResponse,
  UploadStatus,
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

/* ── the venue's colour palette ──────────────────────────────────────────────
   These two endpoints are what the backend is being written against:

     GET  /api/venue/palette?venue_id=…   -> { palette: VenuePalette }
     POST /api/venue/palette              <- { venue_id, colours: [{id, hex}] }
                                          -> { palette: VenuePalette }

   Neither exists on the server yet, so both fall back to a stand-in keyed by
   venue id and the editor works end to end today. Everything above the fallback
   is the real client — when the backend lands, delete `orMock`, `MOCK` and the
   `mocked` flag and no other file has to change. */

const MOCK: Record<string, string[]> = {
  /* the development rig: four pars and a head, so a small warm set */
  ven_desk: ["#ff5a45", "#ffb300", "#e6eaf2", "#3ec7db"],
  /* a club bar: deep and saturated, nothing that washes the room out */
  ven_keycode: ["#e8443d", "#ff8a1f", "#7c4dff", "#00c2ff"],
  /* the arena carries lasers and pixel bars, so it declares more */
  ven_keycode_arena: ["#ff2d55", "#ff9500", "#ffd60a", "#32d74b", "#0a84ff", "#bf5af2"],
  ven_omnia: ["#f5f0e6", "#d4a373", "#6a4c93", "#1b4965"],
};
const MOCK_DEFAULT = ["#e8443d", "#ffb300", "#4fbf87", "#0a84ff", "#bf5af2"];

/** what the client keeps while the backend is not there yet */
const mocked = new Map<string, PaletteColour[]>();

function mockPalette(venueId: string, venueName: string): PaletteResponse {
  if (!mocked.has(venueId)) {
    mocked.set(
      venueId,
      (MOCK[venueId] ?? MOCK_DEFAULT).map((hex, i) => ({ id: `${venueId}-${i}`, hex })),
    );
  }
  return {
    palette: {
      venue_id: venueId,
      venue_name: venueName,
      editable: true,
      colours: mocked.get(venueId)!,
    },
    mocked: true,
  };
}

async function orMock<T extends PaletteResponse>(
  call: () => Promise<T>,
  fallback: () => PaletteResponse,
): Promise<PaletteResponse> {
  try {
    return await call();
  } catch {
    return fallback();
  }
}

export const palette = {
  get(venueId: string, venueName = ""): Promise<PaletteResponse> {
    return orMock(
      () => request<PaletteResponse>(`/api/venue/palette?venue_id=${encodeURIComponent(venueId)}`),
      () => mockPalette(venueId, venueName),
    );
  },

  save(venueId: string, colours: PaletteColour[], venueName = ""): Promise<PaletteResponse> {
    return orMock(
      () => post<PaletteResponse>("/api/venue/palette", { venue_id: venueId, colours }),
      () => {
        mocked.set(venueId, colours);
        return mockPalette(venueId, venueName);
      },
    );
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
