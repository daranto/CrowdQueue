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
  status: "pending" | "locked" | "playing" | "played" | "removed" | "failed";
  score: number;
  requestedAt: string;
  requestedByMe: boolean;
  votedByMe: boolean;
  error: string | null;
}

export interface PartyState {
  party: { code: string; name: string; active: boolean; guestUrl: string };
  nowPlaying: Track | null;
  lockedNext: QueueItem | null;
  queue: QueueItem[];
  nativeQueue: Track[];
  player: {
    isPlaying: boolean;
    progressMs: number;
    deviceId: string | null;
    deviceName: string | null;
    deviceRestricted: boolean;
    updatedAt: string;
    warning: string | null;
  };
  limits: { maxOpenRequests: number; ownOpenRequests: number };
}

export interface AdminState {
  authenticated: boolean;
  configured: boolean;
  connected: boolean;
  setupRequired?: boolean;
  demoMode: boolean;
  csrfToken?: string;
  spotify?: { connected: boolean; displayName: string | null; refreshExpiresAt: string | null; expiringSoon: boolean };
  party?: PartyState | null;
  qrDataUrl?: string | null;
  selectedDeviceId?: string | null;
  devices?: Array<{ id: string; name: string; type: string; isActive: boolean; isRestricted: boolean }>;
  publicBaseUrl?: string;
  lanBaseUrl?: string;
}
