import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import QRCode from "qrcode";
import { config } from "./config.js";
import { QueueController } from "./controller.js";
import { AppDatabase } from "./database.js";
import { PartyEvents } from "./events.js";
import { ipDigest, randomToken, sign, verify } from "./security.js";
import { SpotifyClient, SpotifyError } from "./spotify.js";

const GUEST_COOKIE = "cq_device";
const ADMIN_COOKIE = "cq_admin";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function nowPlus(hours: number): string {
  return new Date(Date.now() + hours * 3600000).toISOString();
}

function cleanOrigin(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/") throw new Error("Ungültige Basis-URL.");
  return url.origin;
}

export interface AppOptions {
  databasePath?: string;
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? config.nodeEnv !== "test", trustProxy: config.trustProxy });
  const db = new AppDatabase(options.databasePath);
  const spotify = new SpotifyClient(db);
  const events = new PartyEvents();
  const controller = new QueueController(db, spotify, events);
  await app.register(cookie);
  await app.register(rateLimit, { global: false, keyGenerator: (request) => verify(request.cookies[GUEST_COOKIE], "guest") ?? ipDigest(request.ip) });

  app.decorateRequest("guestDeviceId", "");
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/parties/")) return;
    let deviceId = verify(request.cookies[GUEST_COOKIE], "guest");
    if (!deviceId) {
      deviceId = randomToken(24);
      reply.setCookie(GUEST_COOKIE, sign(deviceId, "guest"), {
        path: "/",
        httpOnly: true,
        secure: request.protocol === "https",
        sameSite: "strict",
        maxAge: 365 * 86400,
      });
    }
    request.guestDeviceId = deviceId;
    db.touchDevice(deviceId, ipDigest(request.ip));
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("Referrer-Policy", "strict-origin-when-cross-origin")
      .header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
      .header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://i.scdn.co https://mosaic.scdn.co; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'");
    return payload;
  });

  function activeAdmin(request: FastifyRequest): { csrf: string } | null {
    if (config.demoMode && request.headers["x-demo-admin"] === "true") return { csrf: "demo-csrf" };
    const token = verify(request.cookies[ADMIN_COOKIE], "admin");
    if (!token) return null;
    const row = db.sqlite.prepare("SELECT csrf_token FROM admin_sessions WHERE token_hash = ? AND expires_at > ?").get(hash(token), new Date().toISOString()) as { csrf_token: string } | undefined;
    return row ? { csrf: row.csrf_token } : null;
  }

  function requireAdmin(request: FastifyRequest, reply: FastifyReply, mutating = false): { csrf: string } | null {
    const session = activeAdmin(request);
    if (!session) {
      void reply.code(401).send({ error: "Admin-Anmeldung erforderlich." });
      return null;
    }
    if (mutating && request.headers["x-csrf-token"] !== session.csrf) {
      void reply.code(403).send({ error: "Sicherheitsprüfung fehlgeschlagen. Bitte neu laden." });
      return null;
    }
    return session;
  }

  function createAdminSession(request: FastifyRequest, reply: FastifyReply): string {
    const token = randomToken(32);
    const csrf = randomToken(24);
    db.sqlite.prepare("INSERT INTO admin_sessions(token_hash, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?)").run(hash(token), csrf, nowPlus(12), new Date().toISOString());
    reply.setCookie(ADMIN_COOKIE, sign(token, "admin"), { path: "/", httpOnly: true, secure: request.protocol === "https", sameSite: "lax", maxAge: 12 * 3600 });
    return csrf;
  }

  function partyForCode(code: string, reply: FastifyReply) {
    const party = db.getPartyByCode(code);
    if (!party) {
      void reply.code(404).send({ error: "Diese Party wurde nicht gefunden." });
      return null;
    }
    return party;
  }

  function enforcePartyOrigin(request: FastifyRequest, reply: FastifyReply, guestOrigin: string): boolean {
    if (config.nodeEnv !== "production") return true;
    const requestOrigin = `${request.protocol}://${request.headers.host}`;
    const browserOrigin = request.headers.origin;
    if (requestOrigin === guestOrigin && (!browserOrigin || browserOrigin === guestOrigin)) return true;
    void reply.code(403).send({ error: "Dieser Party-Link ist nur über seine ursprüngliche Adresse nutzbar." });
    return false;
  }

  app.get("/healthz", async (_request, reply) => {
    db.sqlite.prepare("SELECT 1").get();
    return reply.send({ ok: true, spotifyConfigured: spotify.isConfigured() });
  });

  app.get<{ Params: { code: string } }>("/api/parties/:code/state", async (request, reply) => {
    const party = partyForCode(request.params.code, reply);
    if (!party) return;
    return reply.send(db.partyState(party, request.guestDeviceId));
  });

  app.get<{ Params: { code: string } }>("/api/parties/:code/events", async (request, reply) => {
    const party = partyForCode(request.params.code, reply);
    if (!party) return;
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const unsubscribe = events.subscribe(Number(party.id), reply.raw);
    request.raw.on("close", unsubscribe);
  });

  app.get<{ Params: { code: string }; Querystring: { q?: string; offset?: string } }>("/api/parties/:code/search", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const party = partyForCode(request.params.code, reply);
    if (!party || !Number(party.active)) return reply.code(410).send({ error: "Diese Party ist bereits beendet." });
    const result = await spotify.search(request.query.q ?? "", Math.max(0, Number(request.query.offset) || 0));
    return reply.send(result);
  });

  app.post<{ Params: { code: string }; Body: { trackId?: string } }>("/api/parties/:code/requests", { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } }, async (request, reply) => {
    const party = partyForCode(request.params.code, reply);
    if (!party) return;
    if (!Number(party.active)) return reply.code(410).send({ error: "Diese Party ist bereits beendet." });
    if (!enforcePartyOrigin(request, reply, String(party.guest_origin))) return;
    try {
      const track = await spotify.track(String(request.body?.trackId ?? ""));
      const result = db.requestTrack(Number(party.id), request.guestDeviceId, track);
      events.publish(Number(party.id));
      return reply.code(result.added ? 201 : 200).send(result);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Musikwunsch konnte nicht hinzugefügt werden." });
    }
  });

  app.put<{ Params: { code: string; itemId: string } }>("/api/parties/:code/queue/:itemId/vote", { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } }, async (request, reply) => {
    const party = partyForCode(request.params.code, reply);
    if (!party || !enforcePartyOrigin(request, reply, String(party.guest_origin))) return;
    try {
      const voted = db.toggleVote(Number(party.id), Number(request.params.itemId), request.guestDeviceId);
      events.publish(Number(party.id));
      return reply.send({ voted });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Abstimmung fehlgeschlagen." });
    }
  });

  app.get("/api/admin/state", async (request, reply) => {
    const session = activeAdmin(request);
    const party = db.getActiveParty();
    if (!session) return reply.send({
      authenticated: false,
      configured: spotify.isConfigured(),
      connected: spotify.isConnected(),
      setupRequired: !db.getSetting("owner_account_id"),
      demoMode: config.demoMode,
    });
    const devices = await spotify.devices().catch(() => []);
    const partyState = party ? db.partyState(party, "") : null;
    return reply.send({
      authenticated: true,
      csrfToken: session.csrf,
      spotify: spotify.connectionInfo(),
      party: partyState,
      qrDataUrl: partyState ? await QRCode.toDataURL(partyState.party.guestUrl, { margin: 1, width: 320 }) : null,
      selectedDeviceId: party?.selected_device_id ?? null,
      devices,
      publicBaseUrl: config.publicBaseUrl,
      lanBaseUrl: config.lanBaseUrl,
      demoMode: config.demoMode,
    });
  });

  app.get<{ Querystring: { setup_token?: string } }>("/api/admin/spotify/login", async (request, reply) => {
    const ownerExists = Boolean(db.getSetting("owner_account_id"));
    if (!ownerExists && request.query.setup_token !== config.adminSetupToken) return reply.code(403).send({ error: "Das einmalige Setup-Token ist ungültig." });
    if (config.demoMode) {
      createAdminSession(request, reply);
      return reply.redirect("/admin");
    }
    if (!spotify.isConfigured()) return reply.code(503).send({ error: "Spotify Client ID und Secret fehlen." });
    const state = randomToken(32);
    db.sqlite.prepare("INSERT INTO oauth_states(state_hash, setup, expires_at) VALUES (?, ?, ?)").run(hash(state), ownerExists ? 0 : 1, nowPlus(0.25));
    return reply.redirect(spotify.authUrl(state));
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/admin/spotify/callback", async (request, reply) => {
    if (request.query.error || !request.query.code || !request.query.state) return reply.redirect("/admin?error=spotify_abgebrochen");
    const state = db.sqlite.prepare("SELECT setup FROM oauth_states WHERE state_hash = ? AND expires_at > ?").get(hash(request.query.state), new Date().toISOString()) as { setup: number } | undefined;
    db.sqlite.prepare("DELETE FROM oauth_states WHERE state_hash = ?").run(hash(request.query.state));
    if (!state) return reply.code(400).send({ error: "Ungültiger oder abgelaufener Spotify-Login." });
    const owner = db.getSetting("owner_account_id");
    let profile: { accountId: string; displayName: string };
    try {
      profile = await spotify.exchangeCode(request.query.code, owner);
    } catch (error) {
      if (error instanceof SpotifyError && error.status === 403) {
        return reply.redirect("/admin?error=falsches_konto");
      }
      throw error;
    }
    if (!owner) db.setSetting("owner_account_id", profile.accountId);
    createAdminSession(request, reply);
    return reply.redirect("/admin?connected=1");
  });

  app.post("/api/admin/logout", async (request, reply) => {
    const token = verify(request.cookies[ADMIN_COOKIE], "admin");
    if (token) db.sqlite.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hash(token));
    reply.clearCookie(ADMIN_COOKIE, { path: "/" });
    return reply.send({ ok: true });
  });

  app.post<{ Body: { name?: string; origin?: "public" | "lan" } }>("/api/admin/parties", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    if (db.getActiveParty()) return reply.code(409).send({ error: "Es läuft bereits eine Party." });
    const name = String(request.body?.name ?? "").trim().slice(0, 80);
    if (name.length < 2) return reply.code(400).send({ error: "Bitte einen Partynamen eingeben." });
    const guestOrigin = cleanOrigin(request.body?.origin === "lan" ? config.lanBaseUrl : config.publicBaseUrl);
    const code = randomToken(12);
    const party = db.createParty(name, code, guestOrigin);
    controller.start();
    void controller.tick();
    const guestUrl = `${guestOrigin}/p/${code}`;
    return reply.code(201).send({ state: db.partyState(party, ""), qrDataUrl: await QRCode.toDataURL(guestUrl, { margin: 1, width: 320 }) });
  });

  app.delete("/api/admin/parties/active", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    const party = db.getActiveParty();
    if (!party) return reply.code(404).send({ error: "Keine aktive Party." });
    db.endParty(Number(party.id));
    events.publish(Number(party.id), "ended");
    return reply.send({ ok: true });
  });

  app.put<{ Body: { deviceId?: string } }>("/api/admin/parties/active/device", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    const party = db.getActiveParty();
    if (!party) return reply.code(404).send({ error: "Keine aktive Party." });
    const device = (await spotify.devices()).find((entry) => entry.id === request.body?.deviceId && !entry.isRestricted);
    if (!device) return reply.code(400).send({ error: "Dieses Spotify-Gerät ist nicht steuerbar." });
    await spotify.transfer(device.id);
    db.selectDevice(Number(party.id), device.id);
    return reply.send({ ok: true });
  });

  app.delete<{ Params: { itemId: string } }>("/api/admin/queue/:itemId", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    const party = db.getActiveParty();
    if (!party) return reply.code(404).send({ error: "Keine aktive Party." });
    try {
      db.removeQueueItem(Number(party.id), Number(request.params.itemId));
      events.publish(Number(party.id));
      return reply.send({ ok: true });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Song konnte nicht entfernt werden." });
    }
  });

  app.get<{ Querystring: { q?: string; offset?: string } }>("/api/admin/search", async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    return reply.send(await spotify.search(request.query.q ?? "", Math.max(0, Number(request.query.offset) || 0)));
  });

  app.post<{ Body: { trackId?: string } }>("/api/admin/player/play-now", async (request, reply) => {
    if (!requireAdmin(request, reply, true)) return;
    const party = db.getActiveParty();
    const trackId = String((request.body as { trackId?: string })?.trackId ?? "");
    const track = await spotify.track(trackId);
    await spotify.playNow(track, party?.selected_device_id ? String(party.selected_device_id) : null);
    if (party) {
      const queued = db.pendingByTrack(Number(party.id), track.id);
      if (queued) db.transition(queued.queueId, ["pending"], "playing");
      events.publish(Number(party.id));
    }
    return reply.send({ ok: true });
  });

  for (const action of ["pause", "resume", "next"] as const) {
    app.post(`/api/admin/player/${action}`, async (request, reply) => {
      if (!requireAdmin(request, reply, true)) return;
      const party = db.getActiveParty();
      await spotify.control(action, party?.selected_device_id ? String(party.selected_device_id) : null);
      return reply.send({ ok: true });
    });
  }

  const staticRoot = join(process.cwd(), "dist-client");
  if (existsSync(staticRoot)) {
    await app.register(fastifyStatic, { root: staticRoot, wildcard: false });
    app.get("/*", async (request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "Nicht gefunden." });
      return reply.sendFile("index.html", { maxAge: 0, immutable: false });
    });
  }

  const heartbeat = setInterval(() => events.heartbeat(), 20000);
  heartbeat.unref();
  const cleanup = setInterval(() => db.purgeOldParties(), 6 * 3600000);
  cleanup.unref();
  controller.start();

  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    clearInterval(cleanup);
    controller.stop();
    db.close();
  });

  return Object.assign(app, { appDb: db, spotify, controller });
}

declare module "fastify" {
  interface FastifyRequest {
    guestDeviceId: string;
  }
}
