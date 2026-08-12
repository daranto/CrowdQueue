import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AppDatabase } from "../server/database.js";
import type { Track } from "../server/types.js";

const tracks: Track[] = Array.from({ length: 6 }, (_, index) => ({
  id: `track-${index + 1}`,
  uri: `spotify:track:track-${index + 1}`,
  name: `Song ${index + 1}`,
  artists: "Test Artist",
  album: "Test Album",
  imageUrl: null,
  spotifyUrl: `https://open.spotify.com/track/track-${index + 1}`,
  durationMs: 180000,
  explicit: index === 5,
}));

function setup() {
  const db = new AppDatabase(":memory:");
  db.touchDevice("device-a", "ip-a");
  db.touchDevice("device-b", "ip-b");
  const party = db.createParty("Testparty", "party-code", "https://party.example");
  return { db, partyId: Number(party.id) };
}

describe("Party Queue", () => {
  it("sortiert nach Stimmen und bei Gleichstand nach dem älteren Wunsch", () => {
    const { db, partyId } = setup();
    const first = db.requestTrack(partyId, "device-a", tracks[0]);
    db.requestTrack(partyId, "device-b", tracks[1]);
    db.toggleVote(partyId, first.queueId, "device-b");
    assert.deepEqual(db.queueItems(partyId, "device-a").map((item) => [item.id, item.score]), [["track-1", 1], ["track-2", 0]]);
    db.toggleVote(partyId, first.queueId, "device-b");
    assert.deepEqual(db.queueItems(partyId, "device-a").map((item) => item.id), ["track-1", "track-2"]);
    db.close();
  });

  it("führt doppelte offene Songs zusammen und zählt nur eine Stimme pro Gerät", () => {
    const { db, partyId } = setup();
    const first = db.requestTrack(partyId, "device-a", tracks[0]);
    const duplicate = db.requestTrack(partyId, "device-b", tracks[0]);
    const sameDevice = db.requestTrack(partyId, "device-b", tracks[0]);
    assert.equal(duplicate.queueId, first.queueId);
    assert.equal(sameDevice.queueId, first.queueId);
    assert.equal(db.queueItems(partyId, "device-a")[0].score, 1);
    db.close();
  });

  it("vergibt keine automatische Stimme und lehnt Votes auf eigene Wünsche ab", () => {
    const { db, partyId } = setup();
    const own = db.requestTrack(partyId, "device-a", tracks[0]);
    assert.equal(db.queueItems(partyId, "device-a")[0].score, 0);
    assert.throws(() => db.toggleVote(partyId, own.queueId, "device-a"), /Eigene Wünsche/);
    assert.equal(db.queueItems(partyId, "device-a")[0].score, 0);
    db.close();
  });

  it("begrenzt jedes Gerät auf drei selbst eingereichte offene Wünsche", () => {
    const { db, partyId } = setup();
    db.requestTrack(partyId, "device-a", tracks[0]);
    db.requestTrack(partyId, "device-a", tracks[1]);
    db.requestTrack(partyId, "device-a", tracks[2]);
    assert.throws(() => db.requestTrack(partyId, "device-a", tracks[3]), /drei offene/);
    db.close();
  });

  it("erlaubt Wiederholungen nach der Wiedergabe und schützt gesperrte Songs", () => {
    const { db, partyId } = setup();
    const first = db.requestTrack(partyId, "device-a", tracks[5]);
    assert.equal(db.transition(first.queueId, ["pending"], "locked"), true);
    assert.throws(() => db.removeQueueItem(partyId, first.queueId), /Nur offene/);
    db.transition(first.queueId, ["locked"], "playing");
    db.transition(first.queueId, ["playing"], "played");
    const replay = db.requestTrack(partyId, "device-a", tracks[5]);
    assert.notEqual(replay.queueId, first.queueId);
    db.close();
  });
});
