import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function secret(name: string, fallback: string): string {
  const value = env(name, fallback);
  if (process.env.NODE_ENV === "production" && value === fallback) {
    throw new Error(`${name} muss in Produktion gesetzt sein.`);
  }
  return value;
}

const databasePath = resolve(env("DATABASE_PATH", "./data/crowdqueue.sqlite"));
mkdirSync(dirname(databasePath), { recursive: true });

export const config = {
  nodeEnv: env("NODE_ENV", "development"),
  host: env("HOST", "0.0.0.0"),
  port: Number(env("PORT", "8080")),
  databasePath,
  publicBaseUrl: env("PUBLIC_BASE_URL", "http://127.0.0.1:8080").replace(/\/$/, ""),
  lanBaseUrl: env("LAN_BASE_URL", "http://127.0.0.1:8080").replace(/\/$/, ""),
  spotifyClientId: env("SPOTIFY_CLIENT_ID"),
  spotifyClientSecret: env("SPOTIFY_CLIENT_SECRET"),
  spotifyRedirectUri: env("SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8080/api/admin/spotify/callback"),
  sessionSecret: secret("SESSION_SECRET", "dev-session-secret-change-me-please-32"),
  encryptionKey: secret("ENCRYPTION_KEY", "dev-encryption-key-change-me-32bytes"),
  adminSetupToken: secret("ADMIN_SETUP_TOKEN", "change-me"),
  trustProxy: env("TRUST_PROXY", "false") === "true",
  demoMode: env("DEMO_MODE", "false") === "true",
  controllerIntervalMs: Number(env("CONTROLLER_INTERVAL_MS", "5000")),
  lockBeforeEndMs: Number(env("LOCK_BEFORE_END_MS", "30000")),
  metadataRetentionDays: 7,
};
