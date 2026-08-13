import { config } from "./config.js";
import { AppDatabase } from "./database.js";
import { decrypt, encrypt } from "./security.js";
import type { PlayerSnapshot, SpotifyDevice, SpotifyRateLimit, Track } from "./types.js";

interface TokenConnection {
  singleton: number;
  account_id: string;
  display_name: string;
  access_token: string;
  access_expires_at: string;
  refresh_token: string;
  refresh_issued_at: string;
  updated_at: string;
}

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter: number | null = null,
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = "SpotifyError";
  }
}

type SearchResult = { items: Track[]; total: number; nextOffset: number | null };

const RATE_LIMIT_UNTIL_KEY = "spotify_rate_limit_until";
const RATE_LIMIT_REASON_KEY = "spotify_rate_limit_reason";
const RATE_LIMIT_ATTEMPTS_KEY = "spotify_rate_limit_attempts";
const SEARCH_CACHE_MS = 2 * 60_000;
const TRACK_CACHE_MS = 10 * 60_000;
const DEVICE_CACHE_MS = 60_000;
const QUEUE_CACHE_MS = 30_000;

function waitText(seconds: number): string {
  const safe = Math.max(1, Math.ceil(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) return `${hours} Std. ${minutes} Min.`;
  if (minutes > 0) return `${minutes} Min.`;
  return `${safe} Sek.`;
}

function rateLimitMessage(reason: string | null, retryAfter: number): string {
  const message = reason === "QUOTA_EXCEEDED"
    ? "Das Spotify-Kontingent ist vorübergehend ausgeschöpft. CrowdQueue wartet automatisch bis zum von Spotify genannten Zeitpunkt."
    : "Spotify begrenzt momentan die Anfragen. CrowdQueue wartet automatisch bis zum von Spotify genannten Zeitpunkt.";
  return `${message} Verbleibende Wartezeit: ca. ${waitText(retryAfter)}`;
}

function retryAfterSeconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  return Number.isFinite(date) && date > Date.now() ? Math.ceil((date - Date.now()) / 1000) : null;
}

const DEMO_TRACKS: Track[] = [
  { id: "demo-1", uri: "spotify:track:demo-1", name: "Midnight City", artists: "M83", album: "Hurry Up, We're Dreaming", imageUrl: null, spotifyUrl: "https://open.spotify.com", durationMs: 244000, explicit: false },
  { id: "demo-2", uri: "spotify:track:demo-2", name: "Dance The Night", artists: "Dua Lipa", album: "Barbie The Album", imageUrl: null, spotifyUrl: "https://open.spotify.com", durationMs: 176000, explicit: false },
  { id: "demo-3", uri: "spotify:track:demo-3", name: "Blinding Lights", artists: "The Weeknd", album: "After Hours", imageUrl: null, spotifyUrl: "https://open.spotify.com", durationMs: 200000, explicit: false },
  { id: "demo-4", uri: "spotify:track:demo-4", name: "Bad Habit", artists: "Steve Lacy", album: "Gemini Rights", imageUrl: null, spotifyUrl: "https://open.spotify.com", durationMs: 231000, explicit: true },
  { id: "demo-5", uri: "spotify:track:demo-5", name: "Levitating", artists: "Dua Lipa", album: "Future Nostalgia", imageUrl: null, spotifyUrl: "https://open.spotify.com", durationMs: 203000, explicit: false },
  { id: "demo-6", uri: "spotify:track:demo-6", name: "September", artists: "Earth, Wind & Fire", album: "The Best of Earth, Wind & Fire", imageUrl: null, spotifyUrl: "https://open.spotify.com", durationMs: 215000, explicit: false },
];

function mapTrack(item: any): Track {
  if (!item || item.type !== "track") throw new SpotifyError("Spotify lieferte keinen abspielbaren Song.", 422);
  return {
    id: item.id,
    uri: item.uri,
    name: item.name,
    artists: (item.artists ?? []).map((artist: any) => artist.name).join(", "),
    album: item.album?.name ?? "",
    imageUrl: item.album?.images?.find((image: any) => image.width >= 300)?.url ?? item.album?.images?.[0]?.url ?? null,
    spotifyUrl: item.external_urls?.spotify ?? `https://open.spotify.com/track/${item.id}`,
    durationMs: item.duration_ms ?? 0,
    explicit: Boolean(item.explicit),
  };
}

export class SpotifyClient {
  private readonly searchCache = new Map<string, { expires: number; result: SearchResult }>();
  private readonly searchInFlight = new Map<string, Promise<SearchResult>>();
  private readonly trackCache = new Map<string, { expires: number; track: Track }>();
  private deviceCache: { expires: number; devices: SpotifyDevice[] } | null = null;
  private nativeQueueCache: { expires: number; tracks: Track[] } | null = null;
  private demoProgress = 30000;

  constructor(private readonly db: AppDatabase) {}

  isConfigured(): boolean {
    return config.demoMode || Boolean(config.spotifyClientId && config.spotifyClientSecret);
  }

  isConnected(): boolean {
    return config.demoMode || Boolean(this.connection());
  }

  rateLimitInfo(): SpotifyRateLimit {
    if (config.demoMode) return { limited: false, retryAfter: 0, until: null, reason: null };
    const until = this.db.getSetting(RATE_LIMIT_UNTIL_KEY);
    const untilMs = until ? Date.parse(until) : Number.NaN;
    if (!Number.isFinite(untilMs) || untilMs <= Date.now()) {
      if (until || this.db.getSetting(RATE_LIMIT_REASON_KEY)) {
        this.db.sqlite.prepare("DELETE FROM settings WHERE key IN (?, ?)").run(RATE_LIMIT_UNTIL_KEY, RATE_LIMIT_REASON_KEY);
      }
      return { limited: false, retryAfter: 0, until: null, reason: null };
    }
    return {
      limited: true,
      retryAfter: Math.max(1, Math.ceil((untilMs - Date.now()) / 1000)),
      until: new Date(untilMs).toISOString(),
      reason: this.db.getSetting(RATE_LIMIT_REASON_KEY),
    };
  }

  ensureAvailable(): void {
    this.assertNotRateLimited();
  }

  private assertNotRateLimited(): void {
    const limit = this.rateLimitInfo();
    if (limit.limited) throw new SpotifyError(rateLimitMessage(limit.reason, limit.retryAfter), 429, limit.retryAfter, limit.reason);
  }

  private rememberRateLimit(retryAfter: number | null, reason: string | null): SpotifyRateLimit {
    const existing = this.rateLimitInfo();
    const previousAttempts = Number(this.db.getSetting(RATE_LIMIT_ATTEMPTS_KEY)) || 0;
    const attempts = previousAttempts + 1;
    this.db.setSetting(RATE_LIMIT_ATTEMPTS_KEY, String(attempts));
    // Spotify's Retry-After header always wins. If it is missing or malformed,
    // back off exponentially instead of retrying in a fixed loop.
    const seconds = retryAfter ?? Math.min(3600, 60 * 2 ** Math.min(attempts - 1, 6));
    const requestedUntil = Date.now() + Math.max(1, seconds) * 1000;
    const existingUntil = existing.until ? Date.parse(existing.until) : 0;
    const until = new Date(Math.max(requestedUntil, existingUntil)).toISOString();
    this.db.setSetting(RATE_LIMIT_UNTIL_KEY, until);
    if (reason || !existing.reason) this.db.setSetting(RATE_LIMIT_REASON_KEY, reason ?? "RATE_LIMITED");
    return this.rateLimitInfo();
  }

  private clearRateLimitState(): void {
    // Ein bereits parallel beobachtetes 429 darf nicht durch eine ältere,
    // später eintreffende erfolgreiche Anfrage aufgehoben werden.
    if (this.rateLimitInfo().limited) return;
    this.db.sqlite.prepare("DELETE FROM settings WHERE key IN (?, ?, ?)").run(
      RATE_LIMIT_UNTIL_KEY,
      RATE_LIMIT_REASON_KEY,
      RATE_LIMIT_ATTEMPTS_KEY,
    );
  }

  private async errorFromResponse(response: Response, fallback: string): Promise<SpotifyError> {
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      // Spotify liefert bei manchen Fehlern absichtlich keinen JSON-Body.
    }
    const reason = typeof body?.error?.reason === "string"
      ? body.error.reason
      : typeof body?.reason === "string"
        ? body.reason
        : typeof body?.error === "string"
          ? body.error
          : null;
    if (response.status === 429) {
      const limit = this.rememberRateLimit(retryAfterSeconds(response.headers.get("retry-after")), reason);
      return new SpotifyError(rateLimitMessage(limit.reason, limit.retryAfter), 429, limit.retryAfter, limit.reason);
    }
    let message = fallback;
    if (typeof body?.error?.message === "string") message = body.error.message;
    else if (body?.error === "invalid_grant") message = "Spotify muss erneut verbunden werden.";
    else if (typeof body?.message === "string") message = body.message;
    return new SpotifyError(message, response.status, null, reason);
  }

  private rememberTrack(track: Track): Track {
    if (this.trackCache.size >= 1_000) {
      const now = Date.now();
      for (const [key, entry] of this.trackCache) {
        if (entry.expires <= now || this.trackCache.size >= 1_000) this.trackCache.delete(key);
        if (this.trackCache.size < 800) break;
      }
    }
    this.trackCache.set(track.id, { expires: Date.now() + TRACK_CACHE_MS, track });
    return track;
  }

  private connection(): TokenConnection | null {
    const row = this.db.sqlite.prepare("SELECT * FROM spotify_connection WHERE singleton = 1").get() as unknown as TokenConnection | undefined;
    return row ?? null;
  }

  private clearConnection(): void {
    this.db.sqlite.prepare("DELETE FROM spotify_connection WHERE singleton = 1").run();
    this.searchCache.clear();
    this.searchInFlight.clear();
    this.trackCache.clear();
    this.deviceCache = null;
    this.nativeQueueCache = null;
  }

  authUrl(state: string): string {
    const url = new URL("https://accounts.spotify.com/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", config.spotifyClientId);
    url.searchParams.set("scope", "user-read-private user-read-playback-state user-read-currently-playing user-modify-playback-state");
    url.searchParams.set("redirect_uri", config.spotifyRedirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("show_dialog", "true");
    return url.toString();
  }

  async exchangeCode(code: string, expectedAccountId: string | null = null): Promise<{ accountId: string; displayName: string }> {
    this.ensureAvailable();
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.spotifyRedirectUri }),
    });
    if (!response.ok) throw await this.errorFromResponse(response, "Spotify-Anmeldung konnte nicht abgeschlossen werden.");
    const token = await response.json() as any;
    const profileResponse = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!profileResponse.ok) throw await this.errorFromResponse(profileResponse, "Spotify-Profil konnte nicht gelesen werden.");
    this.clearRateLimitState();
    const profile = await profileResponse.json() as any;
    const accountId = profile.account_id ?? profile.id;
    if (expectedAccountId && accountId !== expectedAccountId) {
      throw new SpotifyError("Dieses Spotify-Konto ist nicht der festgelegte Besitzer.", 403);
    }
    const now = new Date();
    const existing = this.connection();
    let refreshToken: string;
    let refreshIssuedAt: string;
    if (token.refresh_token) {
      refreshToken = encrypt(token.refresh_token);
      refreshIssuedAt = now.toISOString();
    } else if (existing && existing.account_id === accountId) {
      refreshToken = existing.refresh_token;
      refreshIssuedAt = existing.refresh_issued_at;
    } else {
      throw new SpotifyError("Spotify hat kein erneuerbares Zugriffstoken geliefert.", 502);
    }
    this.db.sqlite.prepare(`
      INSERT INTO spotify_connection(singleton, account_id, display_name, access_token, access_expires_at, refresh_token, refresh_issued_at, updated_at)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(singleton) DO UPDATE SET account_id=excluded.account_id, display_name=excluded.display_name,
        access_token=excluded.access_token, access_expires_at=excluded.access_expires_at,
        refresh_token=excluded.refresh_token, refresh_issued_at=excluded.refresh_issued_at, updated_at=excluded.updated_at
    `).run(
      accountId,
      profile.display_name ?? "Spotify Admin",
      encrypt(token.access_token),
      new Date(now.getTime() + token.expires_in * 1000).toISOString(),
      refreshToken,
      refreshIssuedAt,
      now.toISOString(),
    );
    return { accountId, displayName: profile.display_name ?? "Spotify Admin" };
  }

  private async token(): Promise<string> {
    const connection = this.connection();
    if (!connection) throw new SpotifyError("Spotify ist nicht verbunden.", 401);
    if (Date.parse(connection.access_expires_at) > Date.now() + 60000) return decrypt(connection.access_token);
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: decrypt(connection.refresh_token) }),
    });
    if (!response.ok) {
      const error = await this.errorFromResponse(response, "Spotify-Token konnte nicht erneuert werden.");
      if (error.reason === "invalid_grant") this.clearConnection();
      throw error;
    }
    const payload = await response.json() as any;
    const refreshToken = payload.refresh_token ? encrypt(payload.refresh_token) : connection.refresh_token;
    this.db.sqlite.prepare(`
      UPDATE spotify_connection SET access_token=?, access_expires_at=?, refresh_token=?, refresh_issued_at=?, updated_at=? WHERE singleton=1
    `).run(encrypt(payload.access_token), new Date(Date.now() + payload.expires_in * 1000).toISOString(), refreshToken, connection.refresh_issued_at, new Date().toISOString());
    return payload.access_token;
  }

  private async request(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    this.assertNotRateLimited();
    const token = await this.token();
    const response = await fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    });
    if (response.status === 401 && retry) {
      this.db.sqlite.prepare("UPDATE spotify_connection SET access_expires_at=? WHERE singleton=1").run(new Date(0).toISOString());
      return this.request(path, init, false);
    }
    if (!response.ok) {
      const fallback = response.status === 403
        ? "Spotify hat den Befehl abgelehnt. Premium und Gerätestatus prüfen."
        : `Spotify-Fehler (${response.status}).`;
      throw await this.errorFromResponse(response, fallback);
    }
    this.clearRateLimitState();
    return response;
  }

  async search(query: string, offset: number): Promise<SearchResult> {
    const normalized = query.trim().slice(0, 100);
    if (normalized.length < 2) return { items: [], total: 0, nextOffset: null };
    if (config.demoMode) {
      const items = DEMO_TRACKS.filter((track) => `${track.name} ${track.artists}`.toLowerCase().includes(normalized.toLowerCase())).slice(offset, offset + 10);
      return { items, total: items.length, nextOffset: null };
    }
    const key = `${normalized}:${offset}`;
    const cached = this.searchCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    const pending = this.searchInFlight.get(key);
    if (pending) return pending;
    const request = (async () => {
      const response = await this.request(`/search?${new URLSearchParams({ q: normalized, type: "track", limit: "10", offset: String(Math.max(0, offset)) })}`);
      const payload = await response.json() as any;
      const items = (payload.tracks?.items ?? [])
        .filter((item: any) => item?.is_playable !== false && !item?.is_local)
        .map(mapTrack)
        .map((track: Track) => this.rememberTrack(track));
      const result = { items, total: payload.tracks?.total ?? items.length, nextOffset: payload.tracks?.next ? offset + 10 : null };
      if (this.searchCache.size >= 500) {
        for (const [cacheKey, entry] of this.searchCache) {
          if (entry.expires <= Date.now() || this.searchCache.size >= 500) this.searchCache.delete(cacheKey);
          if (this.searchCache.size < 400) break;
        }
      }
      this.searchCache.set(key, { expires: Date.now() + SEARCH_CACHE_MS, result });
      return result;
    })();
    this.searchInFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (this.searchInFlight.get(key) === request) this.searchInFlight.delete(key);
    }
  }

  async track(id: string): Promise<Track> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new SpotifyError("Ungültige Spotify-Song-ID.", 400);
    if (config.demoMode) {
      const track = DEMO_TRACKS.find((item) => item.id === id);
      if (!track) throw new SpotifyError("Der Demo-Song wurde nicht gefunden.", 404);
      return track;
    }
    const cached = this.trackCache.get(id);
    if (cached && cached.expires > Date.now()) return cached.track;
    const response = await this.request(`/tracks/${encodeURIComponent(id)}`);
    return this.rememberTrack(mapTrack(await response.json()));
  }

  async devices(force = false): Promise<SpotifyDevice[]> {
    if (config.demoMode) return [{ id: "demo-iphone", name: "Party iPhone", type: "Smartphone", isActive: true, isRestricted: false }];
    if (!force && this.deviceCache && this.deviceCache.expires > Date.now()) return this.deviceCache.devices;
    const response = await this.request("/me/player/devices");
    const payload = await response.json() as any;
    const devices = (payload.devices ?? []).filter((device: any) => device.id).map((device: any) => ({
      id: device.id,
      name: device.name,
      type: device.type,
      isActive: Boolean(device.is_active),
      isRestricted: Boolean(device.is_restricted),
    }));
    this.deviceCache = { expires: Date.now() + DEVICE_CACHE_MS, devices };
    return devices;
  }

  async player(): Promise<PlayerSnapshot> {
    if (config.demoMode) {
      this.demoProgress = (this.demoProgress + config.controllerIntervalMs) % DEMO_TRACKS[0].durationMs;
      return {
        isPlaying: true,
        progressMs: this.demoProgress,
        deviceId: "demo-iphone",
        deviceName: "Party iPhone",
        deviceRestricted: false,
        current: DEMO_TRACKS[0],
        nativeQueue: [DEMO_TRACKS[1], DEMO_TRACKS[2]],
        updatedAt: new Date().toISOString(),
        warning: null,
      };
    }
    const stateResponse = await this.request("/me/player");
    if (stateResponse.status === 204) {
      return { isPlaying: false, progressMs: 0, deviceId: null, deviceName: null, deviceRestricted: false, current: null, nativeQueue: [], updatedAt: new Date().toISOString(), warning: "Kein aktives Spotify-Gerät gefunden." };
    }
    const state = await stateResponse.json() as any;
    let nativeQueue: Track[];
    if (this.nativeQueueCache && this.nativeQueueCache.expires > Date.now()) {
      nativeQueue = this.nativeQueueCache.tracks;
    } else {
      const queueResponse = await this.request("/me/player/queue");
      const queue = await queueResponse.json() as any;
      nativeQueue = (queue.queue ?? []).filter((item: any) => item?.type === "track").slice(0, 20).map(mapTrack);
      this.nativeQueueCache = { expires: Date.now() + QUEUE_CACHE_MS, tracks: nativeQueue };
    }
    return {
      isPlaying: Boolean(state.is_playing),
      progressMs: state.progress_ms ?? 0,
      deviceId: state.device?.id ?? null,
      deviceName: state.device?.name ?? null,
      deviceRestricted: Boolean(state.device?.is_restricted),
      current: state.item?.type === "track" ? mapTrack(state.item) : null,
      nativeQueue,
      updatedAt: new Date().toISOString(),
      warning: state.device?.is_restricted ? "Dieses Spotify-Gerät kann nicht ferngesteuert werden." : null,
    };
  }

  async addToQueue(track: Track, deviceId: string | null): Promise<void> {
    if (config.demoMode) return;
    const query = new URLSearchParams({ uri: track.uri });
    if (deviceId) query.set("device_id", deviceId);
    await this.request(`/me/player/queue?${query}`, { method: "POST" });
    if (this.nativeQueueCache) {
      this.nativeQueueCache = {
        expires: Date.now() + QUEUE_CACHE_MS,
        tracks: [...this.nativeQueueCache.tracks, track].slice(0, 20),
      };
    }
  }

  async playNow(track: Track, deviceId: string | null): Promise<void> {
    if (config.demoMode) return;
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    await this.request(`/me/player/play${query}`, { method: "PUT", body: JSON.stringify({ uris: [track.uri] }) });
    this.nativeQueueCache = null;
  }

  async control(action: "pause" | "resume" | "next", deviceId: string | null): Promise<void> {
    if (config.demoMode) return;
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    if (action === "next") {
      await this.request(`/me/player/next${query}`, { method: "POST" });
      this.nativeQueueCache = null;
    }
    else await this.request(`/me/player/${action === "pause" ? "pause" : "play"}${query}`, { method: "PUT" });
  }

  async transfer(deviceId: string): Promise<void> {
    if (config.demoMode) return;
    await this.request("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [deviceId], play: false }) });
    if (this.deviceCache) {
      this.deviceCache = {
        expires: this.deviceCache.expires,
        devices: this.deviceCache.devices.map((device) => ({ ...device, isActive: device.id === deviceId })),
      };
    }
  }

  connectionInfo(): { connected: boolean; displayName: string | null; refreshExpiresAt: string | null; expiringSoon: boolean } {
    if (config.demoMode) return { connected: true, displayName: "Demo Admin", refreshExpiresAt: null, expiringSoon: false };
    const connection = this.connection();
    if (!connection) return { connected: false, displayName: null, refreshExpiresAt: null, expiringSoon: false };
    const refreshExpiresAt = new Date(Date.parse(connection.refresh_issued_at) + 180 * 86400000);
    return { connected: true, displayName: connection.display_name, refreshExpiresAt: refreshExpiresAt.toISOString(), expiringSoon: refreshExpiresAt.getTime() - Date.now() < 30 * 86400000 };
  }
}
