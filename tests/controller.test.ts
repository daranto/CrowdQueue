import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QueueController } from "../server/controller.js";
import { AppDatabase } from "../server/database.js";
import { PartyEvents } from "../server/events.js";
import { SpotifyError } from "../server/spotify.js";
import type { PlayerSnapshot, Track } from "../server/types.js";

const current: Track = { id: "current", uri: "spotify:track:current", name: "Current", artists: "Artist", album: "Album", imageUrl: null, spotifyUrl: "https://open.spotify.com/track/current", durationMs: 100000, explicit: false };
const winner: Track = { ...current, id: "winner", uri: "spotify:track:winner", name: "Winner", spotifyUrl: "https://open.spotify.com/track/winner" };

function setup(player: PlayerSnapshot | Error) {
  const db = new AppDatabase(":memory:");
  db.touchDevice("device", "ip");
  const party = db.createParty("Party", "code", "https://party.example");
  const partyId = Number(party.id);
  const requested = db.requestTrack(partyId, "device", winner);
  let added = 0;
  const spotify = {
    isConnected: () => true,
    rateLimitInfo: () => ({ limited: false, retryAfter: 0, until: null, reason: null }),
    player: async () => { if (player instanceof Error) throw player; return player; },
    addToQueue: async () => { added += 1; },
  };
  const controller = new QueueController(db, spotify as never, new PartyEvents());
  return { db, partyId, requested, controller, added: () => added };
}

describe("Queue Controller", () => {
  it("sperrt genau einen Gewinner innerhalb des 30-Sekunden-Fensters", async () => {
    const snapshot: PlayerSnapshot = { isPlaying: true, progressMs: 71000, deviceId: "iphone", deviceName: "iPhone", deviceRestricted: false, current, nativeQueue: [], updatedAt: new Date().toISOString(), warning: null };
    const test = setup(snapshot);
    await test.controller.tick();
    await test.controller.tick();
    assert.equal(test.added(), 1);
    assert.equal(test.db.lockedItem(test.partyId)?.id, "winner");
    test.db.close();
  });

  it("sendet bei Pause oder eingeschränktem Gerät keinen Queue-Befehl", async () => {
    const snapshot: PlayerSnapshot = { isPlaying: false, progressMs: 90000, deviceId: "iphone", deviceName: "iPhone", deviceRestricted: true, current, nativeQueue: [], updatedAt: new Date().toISOString(), warning: null };
    const test = setup(snapshot);
    await test.controller.tick();
    assert.equal(test.added(), 0);
    assert.equal(test.db.topPending(test.partyId)?.id, "winner");
    test.db.close();
  });

  it("übernimmt Spotify-Fehler als sichtbare Warnung", async () => {
    const test = setup(new SpotifyError("Bitte später erneut versuchen.", 429, 1));
    await test.controller.tick();
    assert.match(test.db.getPlayerState(test.partyId).warning ?? "", /später/);
    test.db.close();
  });
});
