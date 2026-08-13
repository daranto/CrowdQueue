import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { config } from "../server/config.js";
import { AppDatabase } from "../server/database.js";
import { decrypt, encrypt } from "../server/security.js";
import { SpotifyClient } from "../server/spotify.js";

const originalFetch = globalThis.fetch;
const originalDemoMode = config.demoMode;
const originalGuestSpotifyRequestsPerMinute = config.guestSpotifyRequestsPerMinute;
afterEach(() => {
  globalThis.fetch = originalFetch;
  config.demoMode = originalDemoMode;
  config.guestSpotifyRequestsPerMinute = originalGuestSpotifyRequestsPerMinute;
});

function connectedDatabase(): AppDatabase {
  const db = new AppDatabase(":memory:");
  db.sqlite.prepare(`
    INSERT INTO spotify_connection(singleton, account_id, display_name, access_token, access_expires_at, refresh_token, refresh_issued_at, updated_at)
    VALUES (1, 'owner', 'Admin', ?, '2099-01-01T00:00:00.000Z', ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `).run(encrypt("access"), encrypt("refresh"));
  return db;
}

describe("Spotify Admin-Login", () => {
  it("überschreibt die bestehende Verbindung bei einem falschen Konto nicht", async () => {
    const db = new AppDatabase(":memory:");
    db.sqlite.prepare(`
      INSERT INTO spotify_connection(singleton, account_id, display_name, access_token, access_expires_at, refresh_token, refresh_issued_at, updated_at)
      VALUES (1, 'owner', 'Bestehender Admin', 'old-access', '2099-01-01T00:00:00.000Z', 'old-refresh', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    `).run();

    let requestNumber = 0;
    globalThis.fetch = async () => {
      requestNumber += 1;
      if (requestNumber === 1) {
        return Response.json({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 });
      }
      return Response.json({ id: "different-account", display_name: "Falsches Konto" });
    };

    const spotify = new SpotifyClient(db);
    await assert.rejects(() => spotify.exchangeCode("code", "owner"), /nicht der festgelegte Besitzer/);
    const connection = db.sqlite.prepare("SELECT account_id, display_name, access_token, refresh_token FROM spotify_connection WHERE singleton = 1").get() as Record<string, unknown>;
    assert.deepEqual({ ...connection }, {
      account_id: "owner",
      display_name: "Bestehender Admin",
      access_token: "old-access",
      refresh_token: "old-refresh",
    });
    db.close();
  });

  it("speichert Retry-After zentral und sendet während der Sperre keine weiteren Spotify-Aufrufe", async () => {
    config.demoMode = false;
    const db = connectedDatabase();
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return Response.json(
        { error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } },
        { status: 429, headers: { "Retry-After": "21155" } },
      );
    };

    const spotify = new SpotifyClient(db);
    await assert.rejects(() => spotify.devices(), (error: any) => {
      assert.equal(error.status, 429);
      assert.equal(error.reason, "QUOTA_EXCEEDED");
      assert.ok(error.retryAfter >= 21154);
      return true;
    });
    assert.equal(requests, 1);
    assert.equal(spotify.rateLimitInfo().limited, true);

    const restarted = new SpotifyClient(db);
    await assert.rejects(() => restarted.search("test", 0), /Kontingent/);
    assert.equal(requests, 1, "die persistierte Sperre muss den Netzwerkaufruf verhindern");
    db.close();
  });

  it("erhöht die Wartezeit exponentiell, wenn Spotify keinen Retry-After-Header liefert", async () => {
    config.demoMode = false;
    const db = connectedDatabase();
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return Response.json({ error: { status: 429, message: "Too many requests" } }, { status: 429 });
    };

    const spotify = new SpotifyClient(db);
    await assert.rejects(() => spotify.devices(), (error: any) => {
      assert.equal(error.status, 429);
      assert.ok(error.retryAfter >= 59 && error.retryAfter <= 60);
      return true;
    });
    db.setSetting("spotify_rate_limit_until", new Date(0).toISOString());
    await assert.rejects(() => spotify.devices(), (error: any) => {
      assert.equal(error.status, 429);
      assert.ok(error.retryAfter >= 119 && error.retryAfter <= 120);
      return true;
    });
    assert.equal(requests, 2);
    assert.equal(db.getSetting("spotify_rate_limit_attempts"), "2");
    db.close();
  });

  it("hebt eine parallele 429-Sperre nicht durch eine ältere erfolgreiche Antwort auf", async () => {
    config.demoMode = false;
    const db = connectedDatabase();
    let requests = 0;
    let releaseSuccess: ((response: Response) => void) | undefined;
    let signalStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    globalThis.fetch = async () => {
      requests += 1;
      if (requests === 1) {
        signalStarted?.();
        return new Promise<Response>((resolve) => { releaseSuccess = resolve; });
      }
      return Response.json({ error: { status: 429, message: "Too many requests" } }, { status: 429, headers: { "Retry-After": "90" } });
    };

    const spotify = new SpotifyClient(db);
    const olderRequest = spotify.devices(true);
    await started;
    await assert.rejects(() => spotify.devices(true), (error: any) => error.status === 429);
    releaseSuccess?.(Response.json({ devices: [] }));
    await olderRequest;
    assert.equal(spotify.rateLimitInfo().limited, true);
    db.close();
  });

  it("verlängert die sechsmonatige Refresh-Token-Frist bei einer Token-Rotation nicht", async () => {
    config.demoMode = false;
    const db = connectedDatabase();
    db.sqlite.prepare("UPDATE spotify_connection SET access_expires_at = ? WHERE singleton = 1").run(new Date(0).toISOString());
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("accounts.spotify.com/api/token")) {
        return Response.json({ access_token: "new-access", refresh_token: "rotated-refresh", expires_in: 3600 });
      }
      if (url.endsWith("/me/player/devices")) return Response.json({ devices: [] });
      throw new Error(`Unerwarteter Spotify-Aufruf: ${url}`);
    };

    await new SpotifyClient(db).devices();
    const connection = db.sqlite.prepare("SELECT refresh_token, refresh_issued_at FROM spotify_connection WHERE singleton = 1").get() as { refresh_token: string; refresh_issued_at: string };
    assert.equal(decrypt(connection.refresh_token), "rotated-refresh");
    assert.equal(connection.refresh_issued_at, "2026-01-01T00:00:00.000Z");
    db.close();
  });

  it("führt bei parallelen API-Aufrufen nur eine Token-Erneuerung aus", async () => {
    config.demoMode = false;
    const db = connectedDatabase();
    db.sqlite.prepare("UPDATE spotify_connection SET access_expires_at = ? WHERE singleton = 1").run(new Date(0).toISOString());
    let refreshRequests = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("accounts.spotify.com/api/token")) {
        refreshRequests += 1;
        await new Promise<void>((resolve) => setImmediate(resolve));
        return Response.json({ access_token: "shared-access", expires_in: 3600 });
      }
      if (url.endsWith("/me/player/devices")) return Response.json({ devices: [] });
      if (url.includes("/search?")) return Response.json({ tracks: { items: [], total: 0, next: null } });
      throw new Error(`Unerwarteter Spotify-Aufruf: ${url}`);
    };

    const spotify = new SpotifyClient(db);
    await Promise.all([spotify.devices(true), spotify.search("parallele suche", 0, "guest")]);
    assert.equal(refreshRequests, 1);
    db.close();
  });

  it("entfernt bei invalid_grant nur die defekte Verbindung und verlangt eine erneute Anmeldung", async () => {
    config.demoMode = false;
    const db = connectedDatabase();
    db.setSetting("owner_account_id", "owner");
    db.sqlite.prepare("UPDATE spotify_connection SET access_expires_at = ? WHERE singleton = 1").run(new Date(0).toISOString());
    globalThis.fetch = async () => Response.json({ error: "invalid_grant", error_description: "Refresh token revoked" }, { status: 400 });

    const spotify = new SpotifyClient(db);
    await assert.rejects(() => spotify.devices(), (error: any) => {
      assert.equal(error.reason, "invalid_grant");
      assert.match(error.message, /erneut verbunden/);
      return true;
    });
    assert.equal(spotify.connectionInfo().connected, false);
    assert.equal(db.sqlite.prepare("SELECT 1 FROM spotify_connection WHERE singleton = 1").get(), undefined);
    assert.equal(db.getSetting("owner_account_id"), "owner");
    db.close();
  });

  it("cached Geräte und die native Queue, statt sie bei jedem Player-Takt neu zu laden", async () => {
    config.demoMode = false;
    const db = connectedDatabase();
    let deviceRequests = 0;
    let playerRequests = 0;
    let queueRequests = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/me/player/devices")) {
        deviceRequests += 1;
        return Response.json({ devices: [{ id: "iphone", name: "iPhone", type: "Smartphone", is_active: true, is_restricted: false }] });
      }
      if (url.endsWith("/me/player/queue")) {
        queueRequests += 1;
        return Response.json({ queue: [] });
      }
      if (url.endsWith("/me/player")) {
        playerRequests += 1;
        return Response.json({ is_playing: false, progress_ms: 0, device: { id: "iphone", name: "iPhone", is_restricted: false }, item: null });
      }
      throw new Error(`Unerwarteter Spotify-Aufruf: ${url}`);
    };

    const spotify = new SpotifyClient(db);
    await spotify.devices();
    await spotify.devices();
    await spotify.player();
    await spotify.player();
    assert.equal(deviceRequests, 1);
    assert.equal(playerRequests, 2);
    assert.equal(queueRequests, 1);
    db.close();
  });

  it("begrenzt nicht gecachte Gastzugriffe serverweit, ohne Admin-Aufrufe zu blockieren", async () => {
    config.demoMode = false;
    config.guestSpotifyRequestsPerMinute = 2;
    const db = connectedDatabase();
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return Response.json({ tracks: { items: [], total: 0, next: null } });
    };

    const spotify = new SpotifyClient(db);
    await spotify.search("gast eins", 0, "guest");
    await spotify.search("gast zwei", 0, "guest");
    await assert.rejects(() => spotify.track("noch-nicht-gecached", "guest"), (error: any) => {
      assert.equal(error.status, 429);
      assert.equal(error.reason, "GUEST_SPOTIFY_BUDGET");
      assert.ok(error.retryAfter >= 59);
      return true;
    });
    await spotify.search("admin bleibt frei", 0);
    assert.equal(requests, 3, "nur zwei Gastzugriffe und der priorisierte Adminzugriff dürfen Spotify erreichen");
    db.close();
  });

  it("zieht wartende Admin- und Controller-Aufrufe vor weiteren Gastsuchen vor", async () => {
    config.demoMode = false;
    config.guestSpotifyRequestsPerMinute = 10;
    const db = connectedDatabase();
    const order: string[] = [];
    const delayed: Array<(response: Response) => void> = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      order.push(url);
      if (order.length <= 2) return new Promise<Response>((resolve) => delayed.push(resolve));
      if (url.endsWith("/me/player/devices")) return Response.json({ devices: [] });
      return Response.json({ tracks: { items: [], total: 0, next: null } });
    };

    const spotify = new SpotifyClient(db);
    const firstGuest = spotify.search("erster gast", 0, "guest");
    const secondGuest = spotify.search("zweiter gast", 0, "guest");
    const waitingGuest = spotify.search("wartender gast", 0, "guest");
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(order.length, 2, "höchstens zwei Spotify-Web-API-Aufrufe dürfen parallel laufen");

    const trusted = spotify.devices(true);
    await new Promise<void>((resolve) => setImmediate(resolve));
    delayed.shift()?.(Response.json({ tracks: { items: [], total: 0, next: null } }));
    await trusted;
    assert.match(order[2], /\/me\/player\/devices$/, "der wartende vertrauenswürdige Aufruf muss zuerst starten");

    delayed.shift()?.(Response.json({ tracks: { items: [], total: 0, next: null } }));
    await Promise.all([firstGuest, secondGuest, waitingGuest]);
    db.close();
  });
});
