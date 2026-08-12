import { config } from "./config.js";
import { AppDatabase } from "./database.js";
import { decrypt, encrypt } from "./security.js";
import type { PlayerSnapshot, SpotifyDevice, Track } from "./types.js";

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
  ) {
    super(message);
  }
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
  private readonly searchCache = new Map<string, { expires: number; result: { items: Track[]; total: number; nextOffset: number | null } }>();
  private demoProgress = 30000;

  constructor(private readonly db: AppDatabase) {}

  isConfigured(): boolean {
    return config.demoMode || Boolean(config.spotifyClientId && config.spotifyClientSecret);
  }

  isConnected(): boolean {
    return config.demoMode || Boolean(this.connection());
  }

  private connection(): TokenConnection | null {
    const row = this.db.sqlite.prepare("SELECT * FROM spotify_connection WHERE singleton = 1").get() as unknown as TokenConnection | undefined;
    return row ?? null;
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
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.spotifyRedirectUri }),
    });
    if (!response.ok) throw new SpotifyError("Spotify-Anmeldung konnte nicht abgeschlossen werden.", response.status);
    const token = await response.json() as any;
    const profileResponse = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!profileResponse.ok) throw new SpotifyError("Spotify-Profil konnte nicht gelesen werden.", profileResponse.status);
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
    const payload = await response.json() as any;
    if (!response.ok) throw new SpotifyError(payload.error === "invalid_grant" ? "Spotify muss erneut verbunden werden." : "Spotify-Token konnte nicht erneuert werden.", response.status);
    const refreshToken = payload.refresh_token ? encrypt(payload.refresh_token) : connection.refresh_token;
    const refreshIssued = payload.refresh_token ? new Date().toISOString() : connection.refresh_issued_at;
    this.db.sqlite.prepare(`
      UPDATE spotify_connection SET access_token=?, access_expires_at=?, refresh_token=?, refresh_issued_at=?, updated_at=? WHERE singleton=1
    `).run(encrypt(payload.access_token), new Date(Date.now() + payload.expires_in * 1000).toISOString(), refreshToken, refreshIssued, new Date().toISOString());
    return payload.access_token;
  }

  private async request(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
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
      const retryAfter = response.headers.get("retry-after");
      let message = response.status === 403 ? "Spotify hat den Befehl abgelehnt. Premium und Gerätestatus prüfen." : `Spotify-Fehler (${response.status}).`;
      try {
        const body = await response.json() as any;
        message = body?.error?.message ?? message;
      } catch {
        // Spotify liefert bei manchen Fehlern absichtlich keinen JSON-Body.
      }
      throw new SpotifyError(message, response.status, retryAfter ? Number(retryAfter) : null);
    }
    return response;
  }

  async search(query: string, offset: number): Promise<{ items: Track[]; total: number; nextOffset: number | null }> {
    const normalized = query.trim().slice(0, 100);
    if (normalized.length < 2) return { items: [], total: 0, nextOffset: null };
    if (config.demoMode) {
      const items = DEMO_TRACKS.filter((track) => `${track.name} ${track.artists}`.toLowerCase().includes(normalized.toLowerCase())).slice(offset, offset + 10);
      return { items, total: items.length, nextOffset: null };
    }
    const key = `${normalized}:${offset}`;
    const cached = this.searchCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.result;
    const response = await this.request(`/search?${new URLSearchParams({ q: normalized, type: "track", limit: "10", offset: String(Math.max(0, offset)) })}`);
    const payload = await response.json() as any;
    const items = (payload.tracks?.items ?? []).filter((item: any) => item?.is_playable !== false && !item?.is_local).map(mapTrack);
    const result = { items, total: payload.tracks?.total ?? items.length, nextOffset: payload.tracks?.next ? offset + 10 : null };
    this.searchCache.set(key, { expires: Date.now() + 30000, result });
    return result;
  }

  async track(id: string): Promise<Track> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new SpotifyError("Ungültige Spotify-Song-ID.", 400);
    if (config.demoMode) {
      const track = DEMO_TRACKS.find((item) => item.id === id);
      if (!track) throw new SpotifyError("Der Demo-Song wurde nicht gefunden.", 404);
      return track;
    }
    const response = await this.request(`/tracks/${encodeURIComponent(id)}`);
    return mapTrack(await response.json());
  }

  async devices(): Promise<SpotifyDevice[]> {
    if (config.demoMode) return [{ id: "demo-iphone", name: "Party iPhone", type: "Smartphone", isActive: true, isRestricted: false }];
    const response = await this.request("/me/player/devices");
    const payload = await response.json() as any;
    return (payload.devices ?? []).filter((device: any) => device.id).map((device: any) => ({
      id: device.id,
      name: device.name,
      type: device.type,
      isActive: Boolean(device.is_active),
      isRestricted: Boolean(device.is_restricted),
    }));
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
    const [stateResponse, queueResponse] = await Promise.all([this.request("/me/player"), this.request("/me/player/queue")]);
    if (stateResponse.status === 204) {
      return { isPlaying: false, progressMs: 0, deviceId: null, deviceName: null, deviceRestricted: false, current: null, nativeQueue: [], updatedAt: new Date().toISOString(), warning: "Kein aktives Spotify-Gerät gefunden." };
    }
    const state = await stateResponse.json() as any;
    const queue = await queueResponse.json() as any;
    return {
      isPlaying: Boolean(state.is_playing),
      progressMs: state.progress_ms ?? 0,
      deviceId: state.device?.id ?? null,
      deviceName: state.device?.name ?? null,
      deviceRestricted: Boolean(state.device?.is_restricted),
      current: state.item?.type === "track" ? mapTrack(state.item) : null,
      nativeQueue: (queue.queue ?? []).filter((item: any) => item?.type === "track").slice(0, 20).map(mapTrack),
      updatedAt: new Date().toISOString(),
      warning: state.device?.is_restricted ? "Dieses Spotify-Gerät kann nicht ferngesteuert werden." : null,
    };
  }

  async addToQueue(track: Track, deviceId: string | null): Promise<void> {
    if (config.demoMode) return;
    const query = new URLSearchParams({ uri: track.uri });
    if (deviceId) query.set("device_id", deviceId);
    await this.request(`/me/player/queue?${query}`, { method: "POST" });
  }

  async playNow(track: Track, deviceId: string | null): Promise<void> {
    if (config.demoMode) return;
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    await this.request(`/me/player/play${query}`, { method: "PUT", body: JSON.stringify({ uris: [track.uri] }) });
  }

  async control(action: "pause" | "resume" | "next", deviceId: string | null): Promise<void> {
    if (config.demoMode) return;
    const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : "";
    if (action === "next") await this.request(`/me/player/next${query}`, { method: "POST" });
    else await this.request(`/me/player/${action === "pause" ? "pause" : "play"}${query}`, { method: "PUT" });
  }

  async transfer(deviceId: string): Promise<void> {
    if (config.demoMode) return;
    await this.request("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [deviceId], play: false }) });
  }

  connectionInfo(): { connected: boolean; displayName: string | null; refreshExpiresAt: string | null; expiringSoon: boolean } {
    if (config.demoMode) return { connected: true, displayName: "Demo Admin", refreshExpiresAt: null, expiringSoon: false };
    const connection = this.connection();
    if (!connection) return { connected: false, displayName: null, refreshExpiresAt: null, expiringSoon: false };
    const refreshExpiresAt = new Date(Date.parse(connection.refresh_issued_at) + 180 * 86400000);
    return { connected: true, displayName: connection.display_name, refreshExpiresAt: refreshExpiresAt.toISOString(), expiringSoon: refreshExpiresAt.getTime() - Date.now() < 30 * 86400000 };
  }
}
