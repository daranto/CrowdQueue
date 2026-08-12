export type QueueStatus = "pending" | "locked" | "playing" | "played" | "removed" | "failed";

export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album: string;
  imageUrl: string | null;
  spotifyUrl: string;
  durationMs: number;
  explicit: boolean;
}

export interface QueueItem extends Track {
  queueId: number;
  status: QueueStatus;
  score: number;
  requestedAt: string;
  requestedByMe: boolean;
  votedByMe: boolean;
  error: string | null;
}

export interface PlayerSnapshot {
  isPlaying: boolean;
  progressMs: number;
  deviceId: string | null;
  deviceName: string | null;
  deviceRestricted: boolean;
  current: Track | null;
  nativeQueue: Track[];
  updatedAt: string;
  warning: string | null;
}

export interface PartyState {
  party: { code: string; name: string; active: boolean; guestUrl: string };
  nowPlaying: Track | null;
  lockedNext: QueueItem | null;
  queue: QueueItem[];
  nativeQueue: Track[];
  player: Omit<PlayerSnapshot, "current" | "nativeQueue">;
  limits: { maxOpenRequests: number; ownOpenRequests: number };
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  isRestricted: boolean;
}
