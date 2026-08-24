import { useEffect, useState, type ReactNode } from "react";
import { formatTime } from "./api";
import { useI18n } from "./i18n";
import { SUPPORTED_LANGUAGES, type Language } from "./locales";
import type { QueueItem, SpotifyRateLimit, Track } from "./types";

export function Brand({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <a className={`brand ${compact ? "brand--compact" : ""}`} href="/" aria-label={t("CrowdQueue Startseite")}>
      <span className="brand__mark" aria-hidden="true"><i /><i /><i /></span>
      <span>Crowd<span>Queue</span></span>
    </a>
  );
}

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className="language-switcher">
      <span className="sr-only">{t("Sprache")}</span>
      <span className="language-switcher__value" aria-hidden="true">{language.toUpperCase()}</span>
      <select aria-label={t("Sprache")} value={language} onChange={(event) => setLanguage(event.target.value as Language)}>
        {SUPPORTED_LANGUAGES.map((option) => <option key={option} value={option}>{option === "de" ? "Deutsch" : "English"}</option>)}
      </select>
    </label>
  );
}

export function SpotifyLink({ href, children }: { href: string; children?: ReactNode }) {
  const { t } = useI18n();
  return <a className="spotify-link" href={href} target="_blank" rel="noreferrer">Spotify · {children ?? t("Auf Spotify öffnen")} <span aria-hidden="true">↗</span></a>;
}

export function Artwork({ track, size = "normal" }: { track: Track; size?: "small" | "normal" | "hero" }) {
  const { t } = useI18n();
  if (track.imageUrl) {
    return <img className={`artwork artwork--${size}`} src={track.imageUrl} alt={t("Cover von {album}", { album: track.album })} />;
  }
  return <div className={`artwork artwork--${size} artwork--fallback`} aria-hidden="true"><span>{track.name.slice(0, 1)}</span></div>;
}

export function ExplicitBadge() {
  const { t } = useI18n();
  return <span className="explicit" aria-label={t("Expliziter Inhalt")}>E</span>;
}

export function TrackMeta({ track, compact = false }: { track: Track; compact?: boolean }) {
  return (
    <div className="track-meta">
      <p className={compact ? "track-meta__title track-meta__title--compact" : "track-meta__title"} title={track.name}>
        {track.name} {track.explicit && <ExplicitBadge />}
      </p>
      <p className="track-meta__artist" title={`${track.artists} · ${track.album}`}>{track.artists} · {track.album}</p>
    </div>
  );
}

export function SearchResult({
  track,
  actionLabel,
  onAction,
  busy,
  unavailable = false,
  unavailableLabel,
}: {
  track: Track;
  actionLabel: string;
  onAction: () => void;
  busy: boolean;
  unavailable?: boolean;
  unavailableLabel?: string;
}) {
  const { t } = useI18n();
  const resolvedUnavailableLabel = unavailableLabel ?? t("Nicht verfügbar");
  return (
    <li className="search-result">
      <a href={track.spotifyUrl} target="_blank" rel="noreferrer" aria-label={t("{track} auf Spotify öffnen", { track: track.name })}>
        <Artwork track={track} size="small" />
      </a>
      <TrackMeta track={track} compact />
      <span className="search-result__duration" aria-label={t("Dauer {duration}", { duration: formatTime(track.durationMs) })}>{formatTime(track.durationMs)}</span>
      <button
        className={`icon-action ${unavailable ? "icon-action--unavailable" : ""}`}
        type="button"
        onClick={onAction}
        disabled={busy || unavailable}
        aria-busy={busy}
        aria-label={`${unavailable ? resolvedUnavailableLabel : actionLabel}: ${track.name}`}
      >
        <span aria-hidden="true">{busy ? "…" : unavailable ? "✓" : "＋"}</span>
        {unavailable && <small aria-hidden="true">{t("Schon drin")}</small>}
      </button>
    </li>
  );
}

export function QueueRow({ item, position, onVote, onRemove, busy }: { item: QueueItem; position: number; onVote?: () => void; onRemove?: () => void; busy?: boolean }) {
  const { t } = useI18n();
  const votes = t(item.score === 1 ? "Stimme" : "Stimmen");
  return (
    <li className="queue-row">
      <span className="queue-row__position" aria-label={t("Platz {position}", { position })}>{String(position).padStart(2, "0")}</span>
      <a href={item.spotifyUrl} target="_blank" rel="noreferrer" aria-label={t("{track} auf Spotify öffnen", { track: item.name })}><Artwork track={item} size="small" /></a>
      <TrackMeta track={item} compact />
      {onVote && item.requestedByMe && (
        <span className="vote vote--own" title={t("Eigener Wunsch – nicht abstimmbar")}>
          <span aria-hidden="true">—</span><strong>{item.score}</strong>
          <span className="sr-only">{t("Eigener Wunsch: {track}. Andere Gäste haben aktuell {count} {votes} abgegeben.", { track: item.name, count: item.score, votes })}</span>
        </span>
      )}
      {onVote && !item.requestedByMe && (
        <button
          className={`vote ${item.votedByMe ? "vote--active" : ""}`}
          type="button"
          onClick={onVote}
          disabled={busy || item.status !== "pending"}
          aria-pressed={item.votedByMe}
          aria-label={t("{action}: {track}, aktuell {count} {votes}", { action: t(item.votedByMe ? "Stimme entfernen" : "Für Song stimmen"), track: item.name, count: item.score, votes })}
        >
          <span aria-hidden="true">↑</span><strong>{item.score}</strong>
        </button>
      )}
      {onRemove && <button className="remove" type="button" onClick={onRemove} disabled={busy} aria-label={t("{track} entfernen", { track: item.name })}>{t("Entfernen")}</button>}
    </li>
  );
}

export function Notice({ children, tone = "info", live = false }: { children: ReactNode; tone?: "info" | "error" | "success"; live?: boolean }) {
  return <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : "status"} aria-live={live ? "polite" : undefined}>{children}</div>;
}

function formatWaitingTime(seconds: number, t: (key: string, values?: Record<string, string | number>) => string): string {
  const safe = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  if (hours > 0) return t("{hours} Std. {minutes} Min.", { hours, minutes });
  if (minutes > 0) return t("{minutes} Min. {seconds} Sek.", { minutes, seconds: rest });
  return t("{seconds} Sek.", { seconds: rest });
}

export function SpotifyLimitNotice({ limit }: { limit?: SpotifyRateLimit | null }) {
  const { locale, t } = useI18n();
  const [now, setNow] = useState(0);
  const until = limit?.until ? Date.parse(limit.until) : 0;

  useEffect(() => {
    if (!limit?.limited || !Number.isFinite(until) || until <= Date.now()) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 10000);
    return () => window.clearInterval(timer);
  }, [limit?.limited, until]);

  if (!limit?.limited || !Number.isFinite(until) || now === 0 || until <= now) return null;
  const remaining = Math.max(1, Math.ceil((until - now) / 1000));
  const resumesAt = new Date(until).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return (
    <Notice>
      <strong>{t(limit.reason === "QUOTA_EXCEEDED" ? "Spotify-Kontingent ausgeschöpft." : "Spotify begrenzt gerade die Anfragen.")}</strong>{" "}
      {t("Suche und Wiedergabesteuerung pausieren automatisch")} <span aria-hidden="true">{t("noch {time}", { time: formatWaitingTime(remaining, t) })}</span><span className="sr-only">{t("bis {time} Uhr", { time: resumesAt })}</span>. {t("Wünsche und Votes in der bestehenden Party Queue funktionieren weiter.")}
    </Notice>
  );
}

export function Loading({ label }: { label?: string }) {
  const { t } = useI18n();
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label ?? t("Wird geladen …")}</div>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><span aria-hidden="true">♫</span><h3>{title}</h3><p>{children}</p></div>;
}
