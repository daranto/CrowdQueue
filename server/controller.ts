import { config } from "./config.js";
import { AppDatabase } from "./database.js";
import { PartyEvents } from "./events.js";
import { SpotifyClient } from "./spotify.js";
import type { PlayerSnapshot } from "./types.js";

const MIN_DELAY_MS = 2_000;
const PLAYING_WITHOUT_REQUESTS_DELAY_MS = 120_000;
const PLAYING_WITH_REQUESTS_MAX_DELAY_MS = 60_000;
const PAUSED_OR_NO_DEVICE_DELAY_MS = 60_000;
const RESTRICTED_DEVICE_DELAY_MS = 120_000;
const ERROR_DELAY_MS = 60_000;
const DISCONNECTED_DELAY_MS = 5 * 60_000;
const DORMANT_DELAY_MS = 5 * 60_000;
const NATIVE_QUEUE_REFRESH_MS = 5 * 60_000;
const TRACK_END_REFRESH_GRACE_MS = 3_000;
const MAX_TIMEOUT_MS = 24 * 60 * 60_000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function adaptiveControllerDelay(
  snapshot: PlayerSnapshot,
  hasPending: boolean,
  hasLocked: boolean,
  hasLiveListeners = true,
): number {
  const queueNeedsAttention = hasPending || hasLocked;
  if (!snapshot.current || !snapshot.deviceId) {
    return queueNeedsAttention || hasLiveListeners ? PAUSED_OR_NO_DEVICE_DELAY_MS : DORMANT_DELAY_MS;
  }
  if (!snapshot.isPlaying) {
    return queueNeedsAttention || hasLiveListeners ? PAUSED_OR_NO_DEVICE_DELAY_MS : DORMANT_DELAY_MS;
  }
  if (snapshot.deviceRestricted) {
    return queueNeedsAttention || hasLiveListeners ? RESTRICTED_DEVICE_DELAY_MS : DORMANT_DELAY_MS;
  }

  const remaining = Math.max(0, snapshot.current.durationMs - snapshot.progressMs);
  if (hasLocked) {
    return clamp(remaining + TRACK_END_REFRESH_GRACE_MS, MIN_DELAY_MS, PLAYING_WITH_REQUESTS_MAX_DELAY_MS);
  }
  if (hasPending) {
    const untilLockWindow = remaining - config.lockBeforeEndMs;
    return clamp(untilLockWindow, MIN_DELAY_MS, PLAYING_WITH_REQUESTS_MAX_DELAY_MS);
  }
  return hasLiveListeners
    ? clamp(remaining + TRACK_END_REFRESH_GRACE_MS, MIN_DELAY_MS, PLAYING_WITHOUT_REQUESTS_DELAY_MS)
    : DORMANT_DELAY_MS;
}

export class QueueController {
  private timer: NodeJS.Timeout | null = null;
  private timerDueAt = 0;
  private running = false;
  private started = false;
  private pendingWakeDelay: number | null = null;
  private lastNativeQueueRefreshAt = 0;
  private lastPlayerRequestAt = 0;

  constructor(
    private readonly db: AppDatabase,
    private readonly spotify: SpotifyClient,
    private readonly events: PartyEvents,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(0);
  }

  wake(delayMs = 0): void {
    if (!this.started) this.started = true;
    const delay = Math.max(0, delayMs);
    if (this.running) {
      this.pendingWakeDelay = this.pendingWakeDelay === null ? delay : Math.min(this.pendingWakeDelay, delay);
      return;
    }
    this.schedule(delay);
  }

  wakeIfStale(maximumAgeMs: number, delayMs = 0): void {
    if (Date.now() - this.lastPlayerRequestAt < maximumAgeMs) return;
    this.wake(delayMs);
  }

  stop(): void {
    this.started = false;
    this.pendingWakeDelay = null;
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timerDueAt = 0;
  }

  private schedule(delayMs: number): void {
    if (!this.started) return;
    const delay = clamp(delayMs, 0, MAX_TIMEOUT_MS);
    const dueAt = Date.now() + delay;
    if (this.timer && this.timerDueAt <= dueAt) return;
    this.cancelTimer();
    this.timerDueAt = dueAt;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerDueAt = 0;
      void this.tick();
    }, delay);
    this.timer.unref();
  }

  private scheduleAfterRun(delayMs: number): void {
    const requestedWake = this.pendingWakeDelay;
    this.pendingWakeDelay = null;
    this.schedule(requestedWake === null ? delayMs : Math.min(delayMs, requestedWake));
  }

  async tick(): Promise<void> {
    if (this.running) {
      this.pendingWakeDelay = this.pendingWakeDelay === null ? 0 : Math.min(this.pendingWakeDelay, 0);
      return;
    }
    const party = this.db.getActiveParty();
    if (!party) {
      this.cancelTimer();
      return;
    }
    if (!this.spotify.isConnected()) {
      this.schedule(DISCONNECTED_DELAY_MS);
      return;
    }
    const existingLimit = this.spotify.rateLimitInfo();
    if (existingLimit.limited) {
      this.schedule(Math.min(MAX_TIMEOUT_MS, existingLimit.retryAfter * 1_000 + 1_000));
      return;
    }

    this.running = true;
    const partyId = Number(party.id);
    let nextDelay = ERROR_DELAY_MS;
    try {
      const lockedBeforeRefresh = this.db.lockedItem(partyId);
      const refreshNativeQueue = Boolean(lockedBeforeRefresh)
        || Date.now() - this.lastNativeQueueRefreshAt >= NATIVE_QUEUE_REFRESH_MS;
      this.lastPlayerRequestAt = Date.now();
      const snapshot = await this.spotify.player(refreshNativeQueue);
      if (refreshNativeQueue) this.lastNativeQueueRefreshAt = Date.now();
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
        if (row?.locked_at && Date.now() - Date.parse(row.locked_at) > 30_000) {
          this.db.transition(locked.queueId, ["locked"], "failed", "Der Titel ist nicht mehr in der Spotify-Warteschlange.");
        }
      }

      let hasLocked = Boolean(this.db.lockedItem(partyId));
      const remaining = snapshot.current ? snapshot.current.durationMs - snapshot.progressMs : Number.POSITIVE_INFINITY;
      if (
        !hasLocked
        && snapshot.isPlaying
        && snapshot.current
        && !snapshot.deviceRestricted
        && remaining > 0
        && remaining <= config.lockBeforeEndMs
      ) {
        const winner = this.db.topPending(partyId);
        if (winner) {
          await this.spotify.addToQueue(winner, String(party.selected_device_id ?? snapshot.deviceId ?? "") || null);
          this.db.transition(winner.queueId, ["pending"], "locked");
          hasLocked = true;
        }
      }

      const hasPending = Boolean(this.db.topPending(partyId));
      nextDelay = adaptiveControllerDelay(snapshot, hasPending, hasLocked, this.events.listenerCount(partyId) > 0);
      this.events.publish(partyId);
    } catch (error) {
      const previous = this.db.getPlayerState(partyId);
      const message = error instanceof Error ? error.message : "Spotify ist momentan nicht erreichbar.";
      this.db.savePlayerState(partyId, { ...previous, warning: message, updatedAt: new Date().toISOString() });
      this.events.publish(partyId);
      const limit = this.spotify.rateLimitInfo();
      nextDelay = limit.limited
        ? Math.min(MAX_TIMEOUT_MS, limit.retryAfter * 1_000 + 1_000)
        : ERROR_DELAY_MS;
    } finally {
      this.running = false;
      this.scheduleAfterRun(nextDelay);
    }
  }
}
