import { config } from "./config.js";
import { AppDatabase } from "./database.js";
import { PartyEvents } from "./events.js";
import { SpotifyClient } from "./spotify.js";

export class QueueController {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: AppDatabase,
    private readonly spotify: SpotifyClient,
    private readonly events: PartyEvents,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), config.controllerIntervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running || !this.spotify.isConnected() || this.spotify.rateLimitInfo().limited) return;
    const party = this.db.getActiveParty();
    if (!party) return;
    this.running = true;
    const partyId = Number(party.id);
    try {
      const snapshot = await this.spotify.player();
      this.db.savePlayerState(partyId, snapshot);

      const playing = this.db.playingItem(partyId);
      if (playing && snapshot.current?.id !== playing.id) {
        this.db.transition(playing.queueId, ["playing"], "played");
      }

      const locked = this.db.lockedItem(partyId);
      if (locked && snapshot.current?.id === locked.id) {
        this.db.transition(locked.queueId, ["locked"], "playing");
      } else if (locked && !snapshot.nativeQueue.some((track) => track.id === locked.id)) {
        const row = this.db.sqlite.prepare("SELECT locked_at FROM queue_items WHERE id = ?").get(locked.queueId) as { locked_at?: string } | undefined;
        if (row?.locked_at && Date.now() - Date.parse(row.locked_at) > 30000) {
          this.db.transition(locked.queueId, ["locked"], "failed", "Der Titel ist nicht mehr in der Spotify-Warteschlange.");
        }
      }

      const hasLocked = Boolean(this.db.lockedItem(partyId));
      const remaining = snapshot.current ? snapshot.current.durationMs - snapshot.progressMs : Number.POSITIVE_INFINITY;
      if (
        !hasLocked &&
        snapshot.isPlaying &&
        snapshot.current &&
        !snapshot.deviceRestricted &&
        remaining > 0 &&
        remaining <= config.lockBeforeEndMs
      ) {
        const winner = this.db.topPending(partyId);
        if (winner) {
          await this.spotify.addToQueue(winner, String(party.selected_device_id ?? snapshot.deviceId ?? "") || null);
          this.db.transition(winner.queueId, ["pending"], "locked");
        }
      }
      this.events.publish(partyId);
    } catch (error) {
      const previous = this.db.getPlayerState(partyId);
      const message = error instanceof Error ? error.message : "Spotify ist momentan nicht erreichbar.";
      this.db.savePlayerState(partyId, { ...previous, warning: message, updatedAt: new Date().toISOString() });
      this.events.publish(partyId);
    } finally {
      this.running = false;
    }
  }
}
