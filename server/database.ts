import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import type { PartyState, PlayerSnapshot, QueueItem, Track } from "./types.js";

type Row = Record<string, unknown>;

const migrations = [
  `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS spotify_connection (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    account_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    access_token TEXT NOT NULL,
    access_expires_at TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    refresh_issued_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY,
    setup INTEGER NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS parties (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    guest_origin TEXT NOT NULL,
    selected_device_id TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_one_active ON parties(active) WHERE active = 1;
  CREATE TABLE IF NOT EXISTS guest_devices (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_ip_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    uri TEXT NOT NULL,
    name TEXT NOT NULL,
    artists TEXT NOT NULL,
    album TEXT NOT NULL,
    image_url TEXT,
    spotify_url TEXT NOT NULL,
    duration_ms INTEGER NOT NULL,
    explicit INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS queue_items (
    id INTEGER PRIMARY KEY,
    party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id),
    status TEXT NOT NULL CHECK(status IN ('pending','locked','playing','played','removed','failed')),
    requested_by TEXT NOT NULL REFERENCES guest_devices(id),
    requested_at TEXT NOT NULL,
    locked_at TEXT,
    played_at TEXT,
    error TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_open_track ON queue_items(party_id, track_id)
    WHERE status IN ('pending','locked','playing');
  CREATE INDEX IF NOT EXISTS idx_queue_party_status ON queue_items(party_id, status, requested_at);
  CREATE INDEX IF NOT EXISTS idx_queue_requester_open ON queue_items(party_id, requested_by, status);
  CREATE TABLE IF NOT EXISTS votes (
    queue_item_id INTEGER NOT NULL REFERENCES queue_items(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES guest_devices(id),
    created_at TEXT NOT NULL,
    PRIMARY KEY(queue_item_id, device_id)
  );
  CREATE INDEX IF NOT EXISTS idx_votes_queue_item ON votes(queue_item_id);
  CREATE TABLE IF NOT EXISTS player_state (
    party_id INTEGER PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  `
  DELETE FROM votes
  WHERE EXISTS (
    SELECT 1 FROM queue_items
    WHERE queue_items.id = votes.queue_item_id
      AND queue_items.requested_by = votes.device_id
  );
  CREATE TRIGGER IF NOT EXISTS prevent_self_vote
  BEFORE INSERT ON votes
  WHEN EXISTS (
    SELECT 1 FROM queue_items
    WHERE queue_items.id = NEW.queue_item_id
      AND queue_items.requested_by = NEW.device_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'Eigene Wünsche können nicht bewertet werden.');
  END;
  `,
];

function iso(): string {
  return new Date().toISOString();
}

function bool(value: unknown): boolean {
  return Number(value) === 1;
}

export class AppDatabase {
  readonly sqlite: DatabaseSync;

  constructor(path = config.databasePath) {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  private migrate(): void {
    this.sqlite.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    const applied = new Set(
      (this.sqlite.prepare("SELECT version FROM schema_migrations").all() as Row[]).map((row) => Number(row.version)),
    );
    migrations.forEach((sql, index) => {
      const version = index + 1;
      if (applied.has(version)) return;
      this.sqlite.exec("BEGIN IMMEDIATE");
      try {
        this.sqlite.exec(sql);
        this.sqlite.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, iso());
        this.sqlite.exec("COMMIT");
      } catch (error) {
        this.sqlite.exec("ROLLBACK");
        throw error;
      }
    });
    this.sqlite.exec("PRAGMA optimize");
  }

  close(): void {
    this.sqlite.close();
  }

  getSetting(key: string): string | null {
    const row = this.sqlite.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
    return row ? String(row.value) : null;
  }

  setSetting(key: string, value: string): void {
    this.sqlite.prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  touchDevice(id: string, ipHash: string): void {
    this.sqlite.prepare(`
      INSERT INTO guest_devices(id, created_at, last_seen_at, last_ip_hash) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, last_ip_hash = excluded.last_ip_hash
    `).run(id, iso(), iso(), ipHash);
  }

  getActiveParty(): Row | null {
    return (this.sqlite.prepare("SELECT * FROM parties WHERE active = 1 LIMIT 1").get() as Row | undefined) ?? null;
  }

  getPartyByCode(code: string): Row | null {
    return (this.sqlite.prepare("SELECT * FROM parties WHERE code = ?").get(code) as Row | undefined) ?? null;
  }

  createParty(name: string, code: string, guestOrigin: string): Row {
    this.sqlite.prepare("INSERT INTO parties(code, name, guest_origin, active, created_at) VALUES (?, ?, ?, 1, ?)").run(
      code,
      name,
      guestOrigin,
      iso(),
    );
    return this.getActiveParty()!;
  }

  endParty(id: number): void {
    this.sqlite.prepare("UPDATE parties SET active = 0, ended_at = ? WHERE id = ? AND active = 1").run(iso(), id);
  }

  selectDevice(id: number, deviceId: string): void {
    this.sqlite.prepare("UPDATE parties SET selected_device_id = ? WHERE id = ? AND active = 1").run(deviceId, id);
  }

  storeTrack(track: Track): void {
    this.sqlite.prepare(`
      INSERT INTO tracks(id, uri, name, artists, album, image_url, spotify_url, duration_ms, explicit, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET uri=excluded.uri, name=excluded.name, artists=excluded.artists,
        album=excluded.album, image_url=excluded.image_url, spotify_url=excluded.spotify_url,
        duration_ms=excluded.duration_ms, explicit=excluded.explicit, updated_at=excluded.updated_at
    `).run(
      track.id,
      track.uri,
      track.name,
      track.artists,
      track.album,
      track.imageUrl,
      track.spotifyUrl,
      track.durationMs,
      track.explicit ? 1 : 0,
      iso(),
    );
  }

  requestTrack(partyId: number, deviceId: string, track: Track): { queueId: number; added: boolean; voted: boolean } {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      this.storeTrack(track);
      const existing = this.sqlite.prepare(`
        SELECT id, status, requested_by FROM queue_items
        WHERE party_id = ? AND track_id = ? AND status IN ('pending','locked','playing') LIMIT 1
      `).get(partyId, track.id) as Row | undefined;
      if (existing) {
        const vote = String(existing.status) === "pending" && String(existing.requested_by) !== deviceId
          ? this.sqlite.prepare("INSERT OR IGNORE INTO votes(queue_item_id, device_id, created_at) VALUES (?, ?, ?)").run(
              Number(existing.id),
              deviceId,
              iso(),
            )
          : null;
        this.sqlite.exec("COMMIT");
        return { queueId: Number(existing.id), added: false, voted: Number(vote?.changes ?? 0) === 1 };
      }
      const count = this.sqlite.prepare(`
        SELECT COUNT(*) count FROM queue_items
        WHERE party_id = ? AND requested_by = ? AND status IN ('pending','locked')
      `).get(partyId, deviceId) as Row;
      if (Number(count.count) >= 3) throw new Error("Du hast bereits drei offene Musikwünsche.");
      const result = this.sqlite.prepare(`
        INSERT INTO queue_items(party_id, track_id, status, requested_by, requested_at)
        VALUES (?, ?, 'pending', ?, ?)
      `).run(partyId, track.id, deviceId, iso());
      const queueId = Number(result.lastInsertRowid);
      this.sqlite.exec("COMMIT");
      return { queueId, added: true, voted: false };
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  toggleVote(partyId: number, queueId: number, deviceId: string): boolean {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const item = this.sqlite.prepare("SELECT status, requested_by FROM queue_items WHERE id = ? AND party_id = ?").get(queueId, partyId) as Row | undefined;
      if (!item) throw new Error("Der Song wurde nicht gefunden.");
      if (String(item.status) !== "pending") throw new Error("Dieser Song ist bereits fest eingeplant.");
      if (String(item.requested_by) === deviceId) throw new Error("Eigene Wünsche können nicht bewertet werden.");
      const existing = this.sqlite.prepare("SELECT 1 yes FROM votes WHERE queue_item_id = ? AND device_id = ?").get(queueId, deviceId);
      if (existing) {
        this.sqlite.prepare("DELETE FROM votes WHERE queue_item_id = ? AND device_id = ?").run(queueId, deviceId);
        this.sqlite.exec("COMMIT");
        return false;
      }
      this.sqlite.prepare("INSERT INTO votes(queue_item_id, device_id, created_at) VALUES (?, ?, ?)").run(queueId, deviceId, iso());
      this.sqlite.exec("COMMIT");
      return true;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  removeQueueItem(partyId: number, queueId: number): void {
    const result = this.sqlite.prepare(`
      UPDATE queue_items SET status = 'removed' WHERE id = ? AND party_id = ? AND status = 'pending'
    `).run(queueId, partyId);
    if (Number(result.changes) !== 1) throw new Error("Nur offene Songs können entfernt werden.");
  }

  topPending(partyId: number): QueueItem | null {
    return this.queueItems(partyId, "").find((item) => item.status === "pending") ?? null;
  }

  pendingByTrack(partyId: number, trackId: string): QueueItem | null {
    return this.queueItems(partyId, "").find((item) => item.status === "pending" && item.id === trackId) ?? null;
  }

  lockedItem(partyId: number): QueueItem | null {
    return this.queueItems(partyId, "").find((item) => item.status === "locked") ?? null;
  }

  playingItem(partyId: number): QueueItem | null {
    return this.queueItems(partyId, "").find((item) => item.status === "playing") ?? null;
  }

  transition(queueId: number, from: string[], to: string, error: string | null = null): boolean {
    const placeholders = from.map(() => "?").join(",");
    const result = this.sqlite.prepare(`
      UPDATE queue_items SET status = ?, error = ?,
        locked_at = CASE WHEN ? = 'locked' THEN ? ELSE locked_at END,
        played_at = CASE WHEN ? = 'played' THEN ? ELSE played_at END
      WHERE id = ? AND status IN (${placeholders})
    `).run(to, error, to, iso(), to, iso(), queueId, ...from);
    return Number(result.changes) === 1;
  }

  savePlayerState(partyId: number, snapshot: PlayerSnapshot): void {
    this.sqlite.prepare(`
      INSERT INTO player_state(party_id, snapshot_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(party_id) DO UPDATE SET snapshot_json=excluded.snapshot_json, updated_at=excluded.updated_at
    `).run(partyId, JSON.stringify(snapshot), iso());
  }

  getPlayerState(partyId: number): PlayerSnapshot {
    const row = this.sqlite.prepare("SELECT snapshot_json FROM player_state WHERE party_id = ?").get(partyId) as Row | undefined;
    return row
      ? (JSON.parse(String(row.snapshot_json)) as PlayerSnapshot)
      : {
          isPlaying: false,
          progressMs: 0,
          deviceId: null,
          deviceName: null,
          deviceRestricted: false,
          current: null,
          nativeQueue: [],
          updatedAt: iso(),
          warning: "Spotify ist noch nicht verbunden.",
        };
  }

  queueItems(partyId: number, deviceId: string): QueueItem[] {
    const rows = this.sqlite.prepare(`
      SELECT q.id queue_id, q.status, q.requested_at, q.requested_by, q.error,
        t.*, COUNT(v.device_id) score,
        MAX(CASE WHEN v.device_id = ? THEN 1 ELSE 0 END) voted_by_me
      FROM queue_items q
      JOIN tracks t ON t.id = q.track_id
      LEFT JOIN votes v ON v.queue_item_id = q.id
      WHERE q.party_id = ? AND q.status IN ('pending','locked','playing')
      GROUP BY q.id
      ORDER BY CASE q.status WHEN 'playing' THEN 0 WHEN 'locked' THEN 1 ELSE 2 END,
        CASE WHEN q.status = 'pending' THEN COUNT(v.device_id) END DESC, q.requested_at ASC
    `).all(deviceId, partyId) as Row[];
    return rows.map((row) => this.rowToQueueItem(row, deviceId));
  }

  private rowToQueueItem(row: Row, deviceId: string): QueueItem {
    return {
      queueId: Number(row.queue_id),
      id: String(row.id),
      uri: String(row.uri),
      name: String(row.name),
      artists: String(row.artists),
      album: String(row.album),
      imageUrl: row.image_url ? String(row.image_url) : null,
      spotifyUrl: String(row.spotify_url),
      durationMs: Number(row.duration_ms),
      explicit: bool(row.explicit),
      status: String(row.status) as QueueItem["status"],
      score: Number(row.score),
      requestedAt: String(row.requested_at),
      requestedByMe: String(row.requested_by) === deviceId,
      votedByMe: bool(row.voted_by_me),
      error: row.error ? String(row.error) : null,
    };
  }

  partyState(party: Row, deviceId: string, includeSensitivePlayerData = false): PartyState {
    const partyId = Number(party.id);
    const player = this.getPlayerState(partyId);
    const queue = this.queueItems(partyId, deviceId);
    const own = this.sqlite.prepare(`
      SELECT COUNT(*) count FROM queue_items WHERE party_id = ? AND requested_by = ? AND status IN ('pending','locked')
    `).get(partyId, deviceId) as Row;
    return {
      party: {
        code: String(party.code),
        name: String(party.name),
        active: bool(party.active),
        guestUrl: `${String(party.guest_origin)}/p/${String(party.code)}`,
      },
      nowPlaying: player.current,
      lockedNext: queue.find((item) => item.status === "locked") ?? null,
      queue: queue.filter((item) => item.status === "pending"),
      nativeQueue: player.nativeQueue,
      player: {
        isPlaying: player.isPlaying,
        progressMs: player.progressMs,
        deviceId: includeSensitivePlayerData ? player.deviceId : null,
        deviceName: player.deviceName,
        deviceRestricted: player.deviceRestricted,
        updatedAt: player.updatedAt,
        warning: player.warning,
      },
      spotifyRateLimit: { limited: false, retryAfter: 0, until: null, reason: null },
      limits: { maxOpenRequests: 3, ownOpenRequests: Number(own.count) },
    };
  }

  purgeOldParties(): void {
    const cutoff = new Date(
      Date.now() - config.metadataRetentionDays * 24 * 60 * 60 * 1_000,
    ).toISOString();
    this.sqlite.prepare(`
      DELETE FROM parties WHERE active = 0 AND ended_at < ?
    `).run(cutoff);
    this.sqlite.prepare(`
      DELETE FROM tracks WHERE id NOT IN (SELECT track_id FROM queue_items)
        AND updated_at < ?
    `).run(cutoff);
    this.sqlite.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").run(iso());
    this.sqlite.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(iso());
    this.sqlite.prepare(`
      DELETE FROM guest_devices
      WHERE last_seen_at < ?
        AND id NOT IN (SELECT requested_by FROM queue_items)
        AND id NOT IN (SELECT device_id FROM votes)
    `).run(cutoff);
  }
}
