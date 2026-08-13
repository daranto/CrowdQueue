import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppDatabase } from "../server/database.js";
import { ApiMetrics, normalizeSpotifyOperation } from "../server/metrics.js";

describe("API-Statistiken", () => {
  it("fasst Anfragen minutenweise zusammen und trennt Quellen, Fehler und 429", () => {
    const db = new AppDatabase(":memory:");
    const metrics = new ApiMetrics(db);
    metrics.recordInbound("guest", "GET /api/parties/:code/state", 200);
    metrics.recordInbound("guest", "GET /api/parties/:code/state", 200);
    metrics.recordInbound("admin", "POST /api/admin/player/next", 429);
    metrics.recordSpotify("controller", "GET /v1/me/player", 200, 120);
    metrics.recordSpotify("guest", "GET /v1/search", 429, 80);

    const result = metrics.statistics("1h");
    assert.deepEqual(result.summary, {
      inbound: 3,
      inboundRateLimits: 1,
      spotify: 2,
      spotifyErrors: 1,
      spotifyRateLimits: 1,
      averageSpotifyDurationMs: 100,
    });
    assert.deepEqual(result.inboundSources.map((item) => [item.key, item.count]), [["guest", 2], ["admin", 1]]);
    assert.equal(result.spotifyOperations.find((item) => item.key === "GET /v1/search")?.rateLimits, 1);
    metrics.close();
    db.close();
  });

  it("entfernt IDs und Query-Parameter aus Spotify-Operationen", () => {
    assert.equal(
      normalizeSpotifyOperation("https://api.spotify.com/v1/tracks/secret-track-id?market=DE"),
      "GET /v1/tracks/:id",
    );
    assert.equal(
      normalizeSpotifyOperation("https://api.spotify.com/v1/me/player/queue?device_id=secret", "POST"),
      "POST /v1/me/player/queue",
    );
  });
});
