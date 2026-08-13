import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { buildApp } from "../server/app.js";
import { SpotifyError } from "../server/spotify.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

describe("HTTP API", () => {
  it("stellt Healthcheck und Demo-Admin bereit", async () => {
    const app = await buildApp({ databasePath: ":memory:", logger: false });
    apps.push(app);
    assert.equal((await app.inject({ url: "/healthz" })).statusCode, 200);
    const admin = await app.inject({ url: "/api/admin/state", headers: { "x-demo-admin": "true" } });
    assert.equal(admin.statusCode, 200);
    assert.equal(admin.json().authenticated, true);
  });

  it("erstellt eine Party, verhindert Eigenvotes und zählt den Doppelwunsch eines anderen Gasts", async () => {
    const app = await buildApp({ databasePath: ":memory:", logger: false });
    apps.push(app);
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/parties",
      headers: { "x-demo-admin": "true", "x-csrf-token": "demo-csrf" },
      payload: { name: "API Party", origin: "public" },
    });
    assert.equal(created.statusCode, 201);
    const code = created.json().state.party.code;
    const guest = await app.inject({ url: `/api/parties/${code}/state` });
    const cookie = guest.headers["set-cookie"] as string;
    assert.match(cookie, /cq_device=/);
    const requested = await app.inject({ method: "POST", url: `/api/parties/${code}/requests`, headers: { cookie }, payload: { trackId: "demo-2" } });
    assert.equal(requested.statusCode, 201);
    const ownState = await app.inject({ url: `/api/parties/${code}/state`, headers: { cookie } });
    const queueId = ownState.json().queue[0].queueId;
    assert.equal(ownState.json().queue[0].score, 0);
    const ownVote = await app.inject({ method: "PUT", url: `/api/parties/${code}/queue/${queueId}/vote`, headers: { cookie } });
    assert.equal(ownVote.statusCode, 409);
    const repeated = await app.inject({ method: "POST", url: `/api/parties/${code}/requests`, headers: { cookie }, payload: { trackId: "demo-2" } });
    assert.equal(repeated.statusCode, 200);
    const otherGuest = await app.inject({ url: `/api/parties/${code}/state` });
    const otherCookie = otherGuest.headers["set-cookie"] as string;
    const duplicate = await app.inject({ method: "POST", url: `/api/parties/${code}/requests`, headers: { cookie: otherCookie }, payload: { trackId: "demo-2" } });
    assert.equal(duplicate.statusCode, 200);
    assert.equal(duplicate.json().voted, true);
    const state = await app.inject({ url: `/api/parties/${code}/state`, headers: { cookie } });
    assert.equal(state.json().queue.length, 1);
    assert.equal(state.json().queue[0].score, 1);
  });

  it("verlangt bei Admin-Schreibzugriffen CSRF", async () => {
    const app = await buildApp({ databasePath: ":memory:", logger: false });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/api/admin/parties", headers: { "x-demo-admin": "true" }, payload: { name: "Party", origin: "public" } });
    assert.equal(response.statusCode, 403);
  });

  it("verlangt das Setup-Token nur vor dem ersten hinterlegten Besitzer", async () => {
    const app = await buildApp({ databasePath: ":memory:", logger: false });
    apps.push(app);
    const initial = await app.inject({ url: "/api/admin/state" });
    assert.equal(initial.json().setupRequired, true);
    assert.equal((await app.inject({ method: "GET", url: "/api/admin/spotify/login?setup_token=change-me" })).statusCode, 404);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/spotify/login", payload: {} })).statusCode, 403);

    app.appDb.setSetting("owner_account_id", "existing-owner");
    const returning = await app.inject({ url: "/api/admin/state" });
    assert.equal(returning.json().setupRequired, false);
    const login = await app.inject({ method: "POST", url: "/api/admin/spotify/login", payload: {} });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().url, "/admin");
    assert.match(login.headers["set-cookie"] as string, /cq_admin=/);
  });

  it("persistiert für ungültige Party-Codes keine Gastgeräte", async () => {
    const app = await buildApp({ databasePath: ":memory:", logger: false });
    apps.push(app);
    const response = await app.inject({ url: "/api/parties/not-a-real-code/state" });
    assert.equal(response.statusCode, 404);
    const devices = app.appDb.sqlite.prepare("SELECT COUNT(*) count FROM guest_devices").get() as { count: number };
    assert.equal(Number(devices.count), 0);
  });

  it("liefert Spotify-Sperren mit Retry-After an den Admin zurück", async () => {
    const app = await buildApp({ databasePath: ":memory:", logger: false });
    apps.push(app);
    await app.inject({
      method: "POST",
      url: "/api/admin/parties",
      headers: { "x-demo-admin": "true", "x-csrf-token": "demo-csrf" },
      payload: { name: "Rate Limit Party", origin: "public" },
    });
    app.spotify.control = async () => {
      throw new SpotifyError("Spotify wartet.", 429, 120, "QUOTA_EXCEEDED");
    };
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/player/pause",
      headers: { "x-demo-admin": "true", "x-csrf-token": "demo-csrf" },
    });
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers["retry-after"], "120");
    assert.equal(response.json().reason, "QUOTA_EXCEEDED");
  });

  it("reicht den laut Spotify-Spezifikation erlaubten Such-Offset 1000 weiter", async () => {
    const app = await buildApp({ databasePath: ":memory:", logger: false });
    apps.push(app);
    let receivedOffset = -1;
    app.spotify.search = async (_query, offset) => {
      receivedOffset = offset;
      return { items: [], total: 0, nextOffset: null };
    };

    const response = await app.inject({
      url: "/api/admin/search?q=test&offset=1000",
      headers: { "x-demo-admin": "true" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(receivedOffset, 1000);
  });
});
