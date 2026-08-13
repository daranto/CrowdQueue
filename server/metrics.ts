import { AppDatabase } from "./database.js";

export type MetricKind = "inbound" | "spotify";
export type SpotifyRequestSource = "guest" | "admin" | "controller" | "oauth";
export type StatisticsRange = "1h" | "24h" | "7d" | "30d";

interface PendingMetric {
  bucketStart: number;
  kind: MetricKind;
  source: string;
  operation: string;
  statusCode: number;
  count: number;
  durationMs: number;
}

interface AggregateRow {
  key: string;
  request_count: number;
  error_count: number;
  rate_limit_count: number;
}

const MINUTE_MS = 60_000;
const RANGES: Record<StatisticsRange, { durationMs: number; resolutionMs: number }> = {
  "1h": { durationMs: 60 * MINUTE_MS, resolutionMs: 5 * MINUTE_MS },
  "24h": { durationMs: 24 * 60 * MINUTE_MS, resolutionMs: 60 * MINUTE_MS },
  "7d": { durationMs: 7 * 24 * 60 * MINUTE_MS, resolutionMs: 6 * 60 * MINUTE_MS },
  "30d": { durationMs: 30 * 24 * 60 * MINUTE_MS, resolutionMs: 24 * 60 * MINUTE_MS },
};

function cleanLabel(value: string, fallback: string): string {
  const normalized = value.replace(/[\r\n\0]/g, "").trim().slice(0, 160);
  return normalized || fallback;
}

function metricKey(metric: Omit<PendingMetric, "count" | "durationMs">): string {
  return [metric.bucketStart, metric.kind, metric.source, metric.operation, metric.statusCode].join("\u0000");
}

export function normalizeSpotifyOperation(url: string, method = "GET"): string {
  const parsed = new URL(url);
  let path = parsed.pathname;
  path = path.replace(/\/v1\/tracks\/[^/]+$/, "/v1/tracks/:id");
  return `${method.toUpperCase()} ${path}`;
}

export class ApiMetrics {
  private pending = new Map<string, PendingMetric>();
  private readonly flushTimer: NodeJS.Timeout;
  private closed = false;

  constructor(private readonly db: AppDatabase) {
    this.flushTimer = setInterval(() => this.flush(), 30_000);
    this.flushTimer.unref();
  }

  recordInbound(source: string, operation: string, statusCode: number): void {
    this.record("inbound", source, operation, statusCode, 0);
  }

  recordSpotify(source: SpotifyRequestSource, operation: string, statusCode: number, durationMs: number): void {
    this.record("spotify", source, operation, statusCode, durationMs);
  }

  private record(kind: MetricKind, source: string, operation: string, statusCode: number, durationMs: number): void {
    if (this.closed) return;
    const metric = {
      bucketStart: Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS,
      kind,
      source: cleanLabel(source, "unknown"),
      operation: cleanLabel(operation, "UNKNOWN"),
      statusCode: Number.isInteger(statusCode) ? statusCode : 0,
    };
    const key = metricKey(metric);
    const existing = this.pending.get(key);
    if (existing) {
      existing.count += 1;
      existing.durationMs += Math.max(0, Math.round(durationMs));
    } else {
      this.pending.set(key, { ...metric, count: 1, durationMs: Math.max(0, Math.round(durationMs)) });
    }
  }

  flush(): void {
    if (!this.pending.size) return;
    const batch = this.pending;
    this.pending = new Map();
    this.db.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const statement = this.db.sqlite.prepare(`
        INSERT INTO api_metric_buckets(
          bucket_start, kind, source, operation, status_code, request_count, duration_ms_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bucket_start, kind, source, operation, status_code) DO UPDATE SET
          request_count = request_count + excluded.request_count,
          duration_ms_total = duration_ms_total + excluded.duration_ms_total
      `);
      for (const metric of batch.values()) {
        statement.run(
          metric.bucketStart,
          metric.kind,
          metric.source,
          metric.operation,
          metric.statusCode,
          metric.count,
          metric.durationMs,
        );
      }
      this.db.sqlite.exec("COMMIT");
    } catch (error) {
      this.db.sqlite.exec("ROLLBACK");
      for (const [key, metric] of batch) {
        const existing = this.pending.get(key);
        if (existing) {
          existing.count += metric.count;
          existing.durationMs += metric.durationMs;
        } else {
          this.pending.set(key, metric);
        }
      }
      throw error;
    }
  }

  statistics(range: StatisticsRange) {
    this.flush();
    const selected = RANGES[range];
    const now = Date.now();
    const from = Math.floor((now - selected.durationMs) / MINUTE_MS) * MINUTE_MS;
    const timelineFrom = Math.floor(from / selected.resolutionMs) * selected.resolutionMs;
    const to = Math.ceil(now / selected.resolutionMs) * selected.resolutionMs;
    const totals = this.db.sqlite.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN kind = 'inbound' THEN request_count ELSE 0 END), 0) inbound,
        COALESCE(SUM(CASE WHEN kind = 'inbound' AND status_code = 429 THEN request_count ELSE 0 END), 0) inbound_429,
        COALESCE(SUM(CASE WHEN kind = 'spotify' THEN request_count ELSE 0 END), 0) spotify,
        COALESCE(SUM(CASE WHEN kind = 'spotify' AND (status_code = 0 OR status_code >= 400) THEN request_count ELSE 0 END), 0) spotify_errors,
        COALESCE(SUM(CASE WHEN kind = 'spotify' AND status_code = 429 THEN request_count ELSE 0 END), 0) spotify_429,
        COALESCE(SUM(CASE WHEN kind = 'spotify' THEN duration_ms_total ELSE 0 END), 0) spotify_duration
      FROM api_metric_buckets WHERE bucket_start >= ?
    `).get(from) as Record<string, number>;

    const timelineRows = this.db.sqlite.prepare(`
      SELECT
        CAST(bucket_start / ? AS INTEGER) * ? point,
        COALESCE(SUM(CASE WHEN kind = 'inbound' THEN request_count ELSE 0 END), 0) inbound,
        COALESCE(SUM(CASE WHEN kind = 'spotify' THEN request_count ELSE 0 END), 0) spotify,
        COALESCE(SUM(CASE WHEN kind = 'spotify' AND (status_code = 0 OR status_code >= 400) THEN request_count ELSE 0 END), 0) spotify_errors,
        COALESCE(SUM(CASE WHEN kind = 'spotify' AND status_code = 429 THEN request_count ELSE 0 END), 0) spotify_429
      FROM api_metric_buckets WHERE bucket_start >= ?
      GROUP BY point ORDER BY point
    `).all(selected.resolutionMs, selected.resolutionMs, from) as Array<Record<string, number>>;
    const timelineByPoint = new Map(timelineRows.map((row) => [Number(row.point), row]));
    const timeline = [];
    for (let point = timelineFrom; point < to; point += selected.resolutionMs) {
      const row = timelineByPoint.get(point);
      timeline.push({
        at: new Date(point).toISOString(),
        inbound: Number(row?.inbound ?? 0),
        spotify: Number(row?.spotify ?? 0),
        spotifyErrors: Number(row?.spotify_errors ?? 0),
        spotifyRateLimits: Number(row?.spotify_429 ?? 0),
      });
    }

    const breakdown = (kind: MetricKind, column: "source" | "operation", limit: number) => {
      const rows = this.db.sqlite.prepare(`
        SELECT ${column} key,
          SUM(request_count) request_count,
          SUM(CASE WHEN status_code = 0 OR status_code >= 400 THEN request_count ELSE 0 END) error_count,
          SUM(CASE WHEN status_code = 429 THEN request_count ELSE 0 END) rate_limit_count
        FROM api_metric_buckets WHERE kind = ? AND bucket_start >= ?
        GROUP BY ${column} ORDER BY request_count DESC LIMIT ?
      `).all(kind, from, limit) as unknown as AggregateRow[];
      return rows.map((row) => ({
        key: String(row.key),
        count: Number(row.request_count),
        errors: Number(row.error_count),
        rateLimits: Number(row.rate_limit_count),
      }));
    };

    const spotifyCount = Number(totals.spotify);
    return {
      range,
      from: new Date(from).toISOString(),
      to: new Date(now).toISOString(),
      resolutionMinutes: selected.resolutionMs / MINUTE_MS,
      summary: {
        inbound: Number(totals.inbound),
        inboundRateLimits: Number(totals.inbound_429),
        spotify: spotifyCount,
        spotifyErrors: Number(totals.spotify_errors),
        spotifyRateLimits: Number(totals.spotify_429),
        averageSpotifyDurationMs: spotifyCount ? Math.round(Number(totals.spotify_duration) / spotifyCount) : 0,
      },
      timeline,
      inboundSources: breakdown("inbound", "source", 10),
      inboundOperations: breakdown("inbound", "operation", 12),
      spotifySources: breakdown("spotify", "source", 10),
      spotifyOperations: breakdown("spotify", "operation", 12),
    };
  }

  close(): void {
    clearInterval(this.flushTimer);
    this.flush();
    this.closed = true;
  }
}
