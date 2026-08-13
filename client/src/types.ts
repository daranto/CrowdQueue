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

export interface SpotifyRateLimit {
  limited: boolean;
  retryAfter: number;
  until: string | null;
  reason: string | null;
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
  spotifyRateLimit: SpotifyRateLimit;
  limits: { maxOpenRequests: number; ownOpenRequests: number };
}

export interface AdminState {
  authenticated: boolean;
  configured: boolean;
  connected?: boolean;
  setupRequired?: boolean;
  demoMode: boolean;
  csrfToken?: string;
  spotify?: { connected: boolean; displayName: string | null; refreshExpiresAt: string | null; expiringSoon: boolean };
  spotifyRateLimit?: SpotifyRateLimit;
  party?: PartyState | null;
  qrDataUrl?: string | null;
  selectedDeviceId?: string | null;
  devices?: Array<{ id: string; name: string; type: string; isActive: boolean; isRestricted: boolean }>;
  publicBaseUrl?: string;
  lanBaseUrl?: string;
}

export type StatisticsRange = "1h" | "24h" | "7d" | "30d";

export interface MetricBreakdown {
  key: string;
  count: number;
  errors: number;
  rateLimits: number;
}

export interface ApiStatistics {
  range: StatisticsRange;
  from: string;
  to: string;
  resolutionMinutes: number;
  summary: {
    inbound: number;
    inboundRateLimits: number;
    spotify: number;
    spotifyErrors: number;
    spotifyRateLimits: number;
    averageSpotifyDurationMs: number;
  };
  timeline: Array<{
    at: string;
    inbound: number;
    spotify: number;
    spotifyErrors: number;
    spotifyRateLimits: number;
  }>;
  inboundSources: MetricBreakdown[];
  inboundOperations: MetricBreakdown[];
  spotifySources: MetricBreakdown[];
  spotifyOperations: MetricBreakdown[];
}
