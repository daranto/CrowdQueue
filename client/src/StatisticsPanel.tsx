import { useI18n } from "./i18n";
import type { ApiStatistics, MetricBreakdown, StatisticsRange } from "./types";

const sourceLabels: Record<string, string> = {
  guest: "Gäste",
  admin: "Admin-Konsole",
  controller: "Party-Automatik",
  oauth: "Spotify-Anmeldung",
  health: "Healthcheck",
  anonymous: "Nicht angemeldet",
  unknown: "Sonstige",
};

const ranges: Array<{ value: StatisticsRange; label: string }> = [
  { value: "1h", label: "1 Stunde" },
  { value: "24h", label: "24 Stunden" },
  { value: "7d", label: "7 Tage Zeitraum" },
  { value: "30d", label: "30 Tage" },
];

function sourceLabel(key: string, t: (key: string) => string): string {
  return sourceLabels[key] ? t(sourceLabels[key]) : key;
}

function operationLabel(operation: string): string {
  return operation
    .replace("/api/parties/:code", "/Party")
    .replace("/api/admin", "/Admin")
    .replace("/v1", "");
}

function timeLabel(value: string, range: StatisticsRange, locale: string): string {
  const date = new Date(value);
  return range === "1h" || range === "24h"
    ? date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(locale, { day: "2-digit", month: "2-digit" });
}

function TrafficChart({
  title,
  data,
  range,
  value,
  errors,
  tone,
}: {
  title: string;
  data: ApiStatistics["timeline"];
  range: StatisticsRange;
  value: (point: ApiStatistics["timeline"][number]) => number;
  errors?: (point: ApiStatistics["timeline"][number]) => number;
  tone: "inbound" | "spotify";
}) {
  const { locale, t } = useI18n();
  const number = new Intl.NumberFormat(locale);
  const width = 720;
  const height = 220;
  const padding = { top: 18, right: 12, bottom: 34, left: 42 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...data.map(value));
  const gap = Math.min(8, plotWidth / Math.max(1, data.length) * .22);
  const barWidth = Math.max(2, plotWidth / Math.max(1, data.length) - gap);
  const labels = new Set([0, Math.floor((data.length - 1) / 2), Math.max(0, data.length - 1)]);
  const total = data.reduce((sum, point) => sum + value(point), 0);

  return (
    <div className="metric-chart-card">
      <div className="metric-chart-title"><h3>{title}</h3><strong>{number.format(total)}</strong></div>
      <svg className={`metric-chart metric-chart--${tone}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${number.format(total)} ${t("Anfragen im gewählten Zeitraum")}`}>
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={padding.top + plotHeight} />
        <line x1={padding.left} y1={padding.top + plotHeight} x2={width - padding.right} y2={padding.top + plotHeight} />
        <text x={padding.left - 8} y={padding.top + 5} textAnchor="end">{number.format(max)}</text>
        <text x={padding.left - 8} y={padding.top + plotHeight} textAnchor="end">0</text>
        {data.map((point, index) => {
          const amount = value(point);
          const errorAmount = Math.min(amount, errors?.(point) ?? 0);
          const barHeight = amount / max * plotHeight;
          const errorHeight = errorAmount / max * plotHeight;
          const x = padding.left + index * (plotWidth / Math.max(1, data.length)) + gap / 2;
          const y = padding.top + plotHeight - barHeight;
          return (
            <g key={point.at}>
              <title>{`${timeLabel(point.at, range, locale)}: ${number.format(amount)} ${t("Anfragen")}${errorAmount ? `, ${number.format(errorAmount)} ${t("Fehler")}` : ""}`}</title>
              <rect className="metric-chart__bar" x={x} y={y} width={barWidth} height={barHeight} rx="2" />
              {errorHeight > 0 && <rect className="metric-chart__error" x={x} y={padding.top + plotHeight - errorHeight} width={barWidth} height={errorHeight} rx="2" />}
              {labels.has(index) && <text x={x + barWidth / 2} y={height - 9} textAnchor="middle">{timeLabel(point.at, range, locale)}</text>}
            </g>
          );
        })}
      </svg>
      {errors && <div className="metric-legend"><span><i className="metric-legend__total" /> {t("Gesamt")}</span><span><i className="metric-legend__error" /> {t("Fehler inkl. 429")}</span></div>}
    </div>
  );
}

function BreakdownBars({ title, items }: { title: string; items: MetricBreakdown[] }) {
  const { locale, t } = useI18n();
  const number = new Intl.NumberFormat(locale);
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="metric-breakdown">
      <h3>{title}</h3>
      {items.length ? <ol>{items.map((item) => (
        <li key={item.key}>
          <div><span>{sourceLabel(item.key, t)}</span><strong>{number.format(item.count)}</strong></div>
          <span className="metric-breakdown__track" aria-hidden="true"><i style={{ width: `${item.count / max * 100}%` }} /></span>
        </li>
      ))}</ol> : <p>{t("Noch keine Daten.")}</p>}
    </div>
  );
}

function OperationsTable({ title, items }: { title: string; items: MetricBreakdown[] }) {
  const { locale, t } = useI18n();
  const number = new Intl.NumberFormat(locale);
  return (
    <div className="metric-operations">
      <h3>{title}</h3>
      {items.length ? (
        <div className="metric-table-wrap">
          <table>
            <thead><tr><th scope="col">Endpoint</th><th scope="col">{t("Anfragen")}</th><th scope="col">{t("Fehler")}</th><th scope="col">429</th></tr></thead>
            <tbody>{items.map((item) => (
              <tr key={item.key}>
                <th scope="row"><code>{operationLabel(item.key)}</code></th>
                <td>{number.format(item.count)}</td>
                <td className={item.errors ? "metric-value--error" : ""}>{number.format(item.errors)}</td>
                <td className={item.rateLimits ? "metric-value--error" : ""}>{number.format(item.rateLimits)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p>{t("Noch keine Daten.")}</p>}
    </div>
  );
}

export function StatisticsPanel({
  statistics,
  range,
  loading,
  error,
  onRangeChange,
  onRefresh,
}: {
  statistics: ApiStatistics | null;
  range: StatisticsRange;
  loading: boolean;
  error: string | null;
  onRangeChange: (range: StatisticsRange) => void;
  onRefresh: () => void;
}) {
  const { locale, t } = useI18n();
  const number = new Intl.NumberFormat(locale);
  return (
    <section className="admin-card api-statistics" aria-labelledby="api-statistics-title">
      <div className="statistics-heading">
        <div><span className="section-kicker">{t("Diagnose")}</span><h2 id="api-statistics-title">{t("API-Statistik")}</h2></div>
        <div className="statistics-actions">
          <label><span className="sr-only">{t("Zeitraum")}</span><select value={range} onChange={(event) => onRangeChange(event.target.value as StatisticsRange)}>{ranges.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}</select></label>
          <button type="button" className="secondary-button" onClick={onRefresh} disabled={loading}>{t(loading ? "Lädt …" : "Aktualisieren")}</button>
        </div>
      </div>
      <p className="statistics-intro">{t("Gezählt werden normalisierte Endpoints – ohne IP-Adressen, Party-Codes, Suchbegriffe, Song- oder Geräte-IDs. Spotify-Werte enthalten nur echte Netzwerkaufrufe, keine Cache-Treffer.")}</p>
      {error && <p className="statistics-error" role="alert">{error}</p>}
      {!statistics && loading && <div className="statistics-loading">{t("Statistik wird geladen …")}</div>}
      {statistics && (
        <>
          <div className="metric-cards">
            <div><span>{t("Bei CrowdQueue")}</span><strong>{number.format(statistics.summary.inbound)}</strong><small>{t("eingehende API-Anfragen")}</small></div>
            <div><span>{t("An Spotify")}</span><strong>{number.format(statistics.summary.spotify)}</strong><small>{t("echte Web-API-Aufrufe")}</small></div>
            <div className={statistics.summary.spotifyErrors ? "metric-card--warning" : ""}><span>{t("Spotify-Fehler")}</span><strong>{number.format(statistics.summary.spotifyErrors)}</strong><small>{t("Status 4xx, 5xx oder Netzwerk")}</small></div>
            <div className={statistics.summary.spotifyRateLimits ? "metric-card--warning" : ""}><span>Spotify 429</span><strong>{number.format(statistics.summary.spotifyRateLimits)}</strong><small>{t("Rate-Limit-Antworten")}</small></div>
            <div><span>{t("Ø Spotify-Zeit")}</span><strong>{number.format(statistics.summary.averageSpotifyDurationMs)} ms</strong><small>{t("bis zur Antwort")}</small></div>
            <div className={statistics.summary.inboundRateLimits ? "metric-card--warning" : ""}><span>{t("Eigene 429")}</span><strong>{number.format(statistics.summary.inboundRateLimits)}</strong><small>{t("lokal abgewehrte Anfragen")}</small></div>
          </div>
          <div className="metric-chart-grid">
            <TrafficChart title={t("Eingehende API-Anfragen")} data={statistics.timeline} range={range} value={(point) => point.inbound} tone="inbound" />
            <TrafficChart title={t("An Spotify gesendet")} data={statistics.timeline} range={range} value={(point) => point.spotify} errors={(point) => point.spotifyErrors} tone="spotify" />
          </div>
          <p className="statistics-scale-note">{t("Die beiden Diagramme verwenden jeweils eine eigene Skala.")}</p>
          <div className="metric-breakdown-grid">
            <BreakdownBars title={t("Quellen bei CrowdQueue")} items={statistics.inboundSources} />
            <BreakdownBars title={t("Auslöser der Spotify-Aufrufe")} items={statistics.spotifySources} />
          </div>
          <div className="metric-operation-grid">
            <OperationsTable title={t("CrowdQueue-Endpoints")} items={statistics.inboundOperations} />
            <OperationsTable title={t("Spotify-Endpoints")} items={statistics.spotifyOperations} />
          </div>
          <p className="statistics-updated">{t("Stand: {date}. Speicherung: maximal 30 Tage.", { date: new Date(statistics.to).toLocaleString(locale) })}</p>
        </>
      )}
    </section>
  );
}
