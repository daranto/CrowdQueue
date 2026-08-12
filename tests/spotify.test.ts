import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { AppDatabase } from "../server/database.js";
import { SpotifyClient } from "../server/spotify.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

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
});
