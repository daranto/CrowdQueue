import type { ReactNode } from "react";
import { formatTime } from "./api";
import type { QueueItem, Track } from "./types";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <a className={`brand ${compact ? "brand--compact" : ""}`} href="/" aria-label="CrowdQueue Startseite">
      <span className="brand__mark" aria-hidden="true"><i /><i /><i /></span>
      <span>Crowd<span>Queue</span></span>
    </a>
  );
}

export function SpotifyLink({ href, children = "Auf Spotify öffnen" }: { href: string; children?: ReactNode }) {
  return <a className="spotify-link" href={href} target="_blank" rel="noreferrer">Spotify · {children} <span aria-hidden="true">↗</span></a>;
}

export function Artwork({ track, size = "normal" }: { track: Track; size?: "small" | "normal" | "hero" }) {
  if (track.imageUrl) {
    return <img className={`artwork artwork--${size}`} src={track.imageUrl} alt={`Cover von ${track.album}`} />;
  }
  return <div className={`artwork artwork--${size} artwork--fallback`} aria-hidden="true"><span>{track.name.slice(0, 1)}</span></div>;
}

export function ExplicitBadge() {
  return <span className="explicit" aria-label="Expliziter Inhalt">E</span>;
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

export function SearchResult({ track, actionLabel, onAction, busy }: { track: Track; actionLabel: string; onAction: () => void; busy: boolean }) {
  return (
    <li className="search-result">
      <a href={track.spotifyUrl} target="_blank" rel="noreferrer" aria-label={`${track.name} auf Spotify öffnen`}>
        <Artwork track={track} size="small" />
      </a>
      <TrackMeta track={track} compact />
      <span className="search-result__duration" aria-label={`Dauer ${formatTime(track.durationMs)}`}>{formatTime(track.durationMs)}</span>
      <button className="icon-action" type="button" onClick={onAction} disabled={busy} aria-busy={busy} aria-label={`${actionLabel}: ${track.name}`}>
        <span aria-hidden="true">{busy ? "…" : "＋"}</span>
      </button>
    </li>
  );
}

export function QueueRow({ item, position, onVote, onRemove, busy }: { item: QueueItem; position: number; onVote?: () => void; onRemove?: () => void; busy?: boolean }) {
  return (
    <li className="queue-row">
      <span className="queue-row__position" aria-label={`Platz ${position}`}>{String(position).padStart(2, "0")}</span>
      <a href={item.spotifyUrl} target="_blank" rel="noreferrer" aria-label={`${item.name} auf Spotify öffnen`}><Artwork track={item} size="small" /></a>
      <TrackMeta track={item} compact />
      {onVote && item.requestedByMe && (
        <span className="vote vote--own" title="Eigener Wunsch – nicht abstimmbar">
          <span aria-hidden="true">—</span><strong>{item.score}</strong>
          <span className="sr-only">Eigener Wunsch: {item.name}. Andere Gäste haben aktuell {item.score} {item.score === 1 ? "Stimme" : "Stimmen"} abgegeben.</span>
        </span>
      )}
      {onVote && !item.requestedByMe && (
        <button
          className={`vote ${item.votedByMe ? "vote--active" : ""}`}
          type="button"
          onClick={onVote}
          disabled={busy || item.status !== "pending"}
          aria-pressed={item.votedByMe}
          aria-label={`${item.votedByMe ? "Stimme entfernen" : "Für Song stimmen"}: ${item.name}, aktuell ${item.score} ${item.score === 1 ? "Stimme" : "Stimmen"}`}
        >
          <span aria-hidden="true">↑</span><strong>{item.score}</strong>
        </button>
      )}
      {onRemove && <button className="remove" type="button" onClick={onRemove} disabled={busy} aria-label={`${item.name} entfernen`}>Entfernen</button>}
    </li>
  );
}

export function Notice({ children, tone = "info", live = false }: { children: ReactNode; tone?: "info" | "error" | "success"; live?: boolean }) {
  return <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : "status"} aria-live={live ? "polite" : undefined}>{children}</div>;
}

export function Loading({ label = "Wird geladen …" }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label}</div>;
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><span aria-hidden="true">♫</span><h3>{title}</h3><p>{children}</p></div>;
}
