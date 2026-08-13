import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { FastifyServerOptions } from "fastify";

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function secret(name: string, fallback: string, minimumLength = 32): string {
  const value = env(name, fallback);
  if (process.env.NODE_ENV === "production" && (value === fallback || value.length < minimumLength)) {
    throw new Error(`${name} muss in Produktion gesetzt sein und mindestens ${minimumLength} Zeichen haben.`);
  }
  return value;
}

function proxyTrust(value: string): FastifyServerOptions["trustProxy"] {
  const normalized = value.toLowerCase();
  if (!value || normalized === "false") return false;
  // Historische TRUST_PROXY=true-Installationen bleiben funktionsfähig, vertrauen
  // aber nicht länger beliebigen öffentlichen Absendern.
  if (normalized === "true") return ["loopback", "linklocal", "uniquelocal"];
  if (/^\d+$/.test(value)) return Number(value);
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

export function validateSpotifyRedirectUri(value: string): string {
  if (value.includes("*")) throw new Error("SPOTIFY_REDIRECT_URI darf keine Wildcards enthalten.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SPOTIFY_REDIRECT_URI muss eine gültige absolute URL sein.");
  }
  if (url.username || url.password) throw new Error("SPOTIFY_REDIRECT_URI darf keine Zugangsdaten enthalten.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost") {
    throw new Error("SPOTIFY_REDIRECT_URI darf localhost nicht verwenden; nutze für lokale Tests 127.0.0.1.");
  }
  const loopback = hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("SPOTIFY_REDIRECT_URI muss HTTPS verwenden; HTTP ist nur für 127.0.0.1 oder [::1] erlaubt.");
  }
  return value;
}

export function validateDemoMode(value: boolean, nodeEnv: string): boolean {
  if (value && nodeEnv === "production") throw new Error("DEMO_MODE darf in Produktion nicht aktiviert sein.");
  return value;
}

const databasePath = resolve(env("DATABASE_PATH", "./data/crowdqueue.sqlite"));
mkdirSync(dirname(databasePath), { recursive: true });
const nodeEnv = env("NODE_ENV", "development");

export const config = {
  nodeEnv,
  host: env("HOST", "0.0.0.0"),
  port: Number(env("PORT", "8080")),
  databasePath,
  publicBaseUrl: env("PUBLIC_BASE_URL", "http://127.0.0.1:8080").replace(/\/$/, ""),
  lanBaseUrl: env("LAN_BASE_URL", "http://127.0.0.1:8080").replace(/\/$/, ""),
  spotifyClientId: env("SPOTIFY_CLIENT_ID"),
  spotifyClientSecret: env("SPOTIFY_CLIENT_SECRET"),
  spotifyRedirectUri: validateSpotifyRedirectUri(env("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8080/api/admin/spotify/callback")),
  sessionSecret: secret("SESSION_SECRET", "dev-session-secret-change-me-please-32"),
  encryptionKey: secret("ENCRYPTION_KEY", "dev-encryption-key-change-me-32bytes"),
  adminSetupToken: secret("ADMIN_SETUP_TOKEN", "change-me", 24),
  healthcheckToken: secret("HEALTHCHECK_TOKEN", "dev-healthcheck-token-change-me-32", 32),
  trustProxy: proxyTrust(env("TRUST_PROXY", "false")),
  demoMode: validateDemoMode(env("DEMO_MODE", "false") === "true", nodeEnv),
  guestSpotifyRequestsPerMinute: Math.max(1, Number(env("GUEST_SPOTIFY_REQUESTS_PER_MINUTE", "20")) || 20),
  lockBeforeEndMs: Number(env("LOCK_BEFORE_END_MS", "30000")),
  metadataRetentionDays: 7,
};
