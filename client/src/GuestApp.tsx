import { useCallback, useEffect, useMemo, useRef, useState, type AnimationEvent as ReactAnimationEvent } from "react";
import { ApiError, api, formatTime } from "./api";
import { Artwork, Brand, EmptyState, LanguageSwitcher, Loading, Notice, QueueRow, SearchResult, SpotifyLimitNotice, SpotifyLink, TrackMeta } from "./components";
import { useI18n } from "./i18n";
import { SpotifyQueueDialog } from "./SpotifyQueueDialog";
import type { PartyState, Track } from "./types";
import { useSearch } from "./useSearch";
import { useTrackTransition } from "./useTrackTransition";

type NextTrackPhase = "entering" | "visible" | "exiting";

const NEXT_TRACK_EXIT_FALLBACK_MS = 700;

export function GuestApp({ code }: { code: string }) {
  const { serverMessage, t } = useI18n();
  const [state, setState] = useState<PartyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requestFeedback, setRequestFeedback] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | number | null>(null);
  const [progressClock, setProgressClock] = useState(() => Date.now());
  const [spotifyQueueOpen, setSpotifyQueueOpen] = useState(false);
  const [renderedLockedNext, setRenderedLockedNext] = useState<Track | null>(null);
  const [nextTrackPhase, setNextTrackPhaseState] = useState<NextTrackPhase>("visible");
  const renderedLockedNextRef = useRef<Track | null>(null);
  const pendingLockedNextRef = useRef<Track | null>(null);
  const nextTrackPhaseRef = useRef<NextTrackPhase>("visible");
  const nextTrackExitTimerRef = useRef<number | null>(null);
  const spotifyQueueButtonRef = useRef<HTMLButtonElement>(null);
  const rateLimited = state?.spotifyRateLimit.limited ?? false;
  const search = useSearch(`/api/parties/${code}/search`, rateLimited ? "" : query);
  const currentTrackTransition = useTrackTransition(state?.nowPlaying ?? null);

  const closeSpotifyQueue = useCallback(() => {
    setSpotifyQueueOpen(false);
    window.requestAnimationFrame(() => spotifyQueueButtonRef.current?.focus());
  }, []);

  const setNextTrackPhase = useCallback((phase: NextTrackPhase) => {
    nextTrackPhaseRef.current = phase;
    setNextTrackPhaseState(phase);
  }, []);

  const clearNextTrackExitTimer = useCallback(() => {
    if (nextTrackExitTimerRef.current !== null) window.clearTimeout(nextTrackExitTimerRef.current);
    nextTrackExitTimerRef.current = null;
  }, []);

  const showNextTrack = useCallback((track: Track) => {
    renderedLockedNextRef.current = track;
    setRenderedLockedNext(track);
    setNextTrackPhase("entering");
  }, [setNextTrackPhase]);

  const finishNextTrackExit = useCallback(() => {
    clearNextTrackExitTimer();
    const pending = pendingLockedNextRef.current;
    pendingLockedNextRef.current = null;
    if (pending) {
      showNextTrack(pending);
      return;
    }
    renderedLockedNextRef.current = null;
    setRenderedLockedNext(null);
    setNextTrackPhase("visible");
  }, [clearNextTrackExitTimer, setNextTrackPhase, showNextTrack]);

  const startNextTrackExit = useCallback(() => {
    if (!renderedLockedNextRef.current || nextTrackPhaseRef.current === "exiting") return;
    setNextTrackPhase("exiting");
    clearNextTrackExitTimer();
    nextTrackExitTimerRef.current = window.setTimeout(finishNextTrackExit, NEXT_TRACK_EXIT_FALLBACK_MS);
  }, [clearNextTrackExitTimer, finishNextTrackExit, setNextTrackPhase]);

  const load = useCallback(async (announce = false) => {
    try {
      const next = await api<PartyState>(`/api/parties/${code}/state`);
      setState(next);
      setError(null);
      if (announce) setMessage(t("Warteschlange aktualisiert."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Party konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [code, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const incoming = state?.lockedNext ?? null;
    const rendered = renderedLockedNextRef.current;

    if (!incoming) {
      pendingLockedNextRef.current = null;
      if (rendered) startNextTrackExit();
      return;
    }

    if (!rendered) {
      pendingLockedNextRef.current = null;
      showNextTrack(incoming);
      return;
    }

    if (rendered.id === incoming.id) {
      renderedLockedNextRef.current = incoming;
      setRenderedLockedNext(incoming);
      pendingLockedNextRef.current = null;
      if (nextTrackPhaseRef.current === "exiting") {
        clearNextTrackExitTimer();
        setNextTrackPhase("visible");
      }
      return;
    }

    pendingLockedNextRef.current = incoming;
    startNextTrackExit();
  }, [clearNextTrackExitTimer, setNextTrackPhase, showNextTrack, startNextTrackExit, state?.lockedNext]);
  useEffect(() => () => clearNextTrackExitTimer(), [clearNextTrackExitTimer]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void load();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (search.errorStatus === 429) void load();
  }, [load, search.errorStatus]);

  useEffect(() => {
    let events: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let pollingTimer: number | null = null;
    let disposed = false;

    const stopReconnect = () => {
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    };

    const stopPolling = () => {
      if (pollingTimer !== null) window.clearInterval(pollingTimer);
      pollingTimer = null;
    };

    const startPolling = () => {
      if (pollingTimer !== null) return;
      pollingTimer = window.setInterval(() => {
        if (document.visibilityState === "visible" && navigator.onLine) void load();
      }, 10000);
    };

    const connect = (force = false) => {
      if (disposed || document.visibilityState === "hidden" || !navigator.onLine) return;
      if (!force && events && events.readyState !== EventSource.CLOSED) return;
      stopReconnect();
      events?.close();

      const connection = new EventSource(`/api/parties/${code}/events`);
      events = connection;
      connection.addEventListener("state", () => void load());
      connection.addEventListener("ended", () => void load(true));
      connection.onopen = () => {
        if (events === connection) stopPolling();
      };
      connection.onerror = () => {
        if (events !== connection) return;
        connection.close();
        events = null;
        startPolling();
        stopReconnect();
        reconnectTimer = window.setTimeout(() => connect(), 3000);
      };
    };

    const refreshAfterResume = () => {
      if (disposed || document.visibilityState === "hidden") return;
      void load();
      connect(true);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        events?.close();
        events = null;
        stopReconnect();
        stopPolling();
      } else {
        refreshAfterResume();
      }
    };

    connect();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pageshow", refreshAfterResume);
    window.addEventListener("online", refreshAfterResume);

    return () => {
      disposed = true;
      events?.close();
      stopReconnect();
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pageshow", refreshAfterResume);
      window.removeEventListener("online", refreshAfterResume);
    };
  }, [code, load]);

  useEffect(() => {
    setProgressClock(Date.now());
    if (!state?.player.isPlaying || !state.nowPlaying) return;
    const timer = window.setInterval(() => setProgressClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state?.nowPlaying, state?.player.isPlaying]);

  async function requestTrack(track: Track) {
    setBusyId(track.id);
    setRequestFeedback(null);
    try {
      const result = await api<{ added: boolean; voted: boolean }>(`/api/parties/${code}/requests`, { method: "POST", body: JSON.stringify({ trackId: track.id }) });
      setRequestFeedback({
        tone: "success",
        text: result.added
          ? t("{track} wurde gewünscht.", { track: track.name })
          : result.voted
            ? t("Deine Stimme für {track} wurde gezählt.", { track: track.name })
            : t("{track} ist bereits in der Queue.", { track: track.name }),
      });
      await load();
    } catch (caught) {
      setRequestFeedback({
        tone: "error",
        text: caught instanceof Error ? caught.message : t("Musikwunsch fehlgeschlagen."),
      });
      if (caught instanceof ApiError && caught.status === 429) await load();
    } finally {
      setBusyId(null);
    }
  }

  async function vote(itemId: number) {
    setBusyId(itemId);
    try {
      await api(`/api/parties/${code}/queue/${itemId}/vote`, { method: "PUT" });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Abstimmung fehlgeschlagen."));
    } finally {
      setBusyId(null);
    }
  }

  const estimatedProgressMs = useMemo(() => {
    if (!state?.nowPlaying?.durationMs) return 0;
    const measuredAt = Date.parse(state.player.updatedAt);
    const elapsed = state.player.isPlaying && Number.isFinite(measuredAt) ? Math.max(0, progressClock - measuredAt) : 0;
    return Math.min(state.nowPlaying.durationMs, state.player.progressMs + elapsed);
  }, [progressClock, state]);
  const renderedNowPlaying = currentTrackTransition.renderedTrack;
  const renderedProgressMs = renderedNowPlaying?.id === state?.nowPlaying?.id
    ? estimatedProgressMs
    : renderedNowPlaying?.durationMs ?? 0;
  const progress = renderedNowPlaying?.durationMs ? Math.min(100, renderedProgressMs / renderedNowPlaying.durationMs * 100) : 0;

  const remainingRequests = Math.max(0, (state?.limits.maxOpenRequests ?? 3) - (state?.limits.ownOpenRequests ?? 0));
  const requestedTrackIds = useMemo(() => {
    const ids = new Set(state?.queue.map((item) => item.id) ?? []);
    if (state?.lockedNext) ids.add(state.lockedNext.id);
    return ids;
  }, [state]);

  const handleNextTrackAnimationEnd = (event: ReactAnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.animationName.includes("next-track-enter") && nextTrackPhaseRef.current === "entering") {
      setNextTrackPhase("visible");
    } else if (event.animationName.includes("next-track-exit") && nextTrackPhaseRef.current === "exiting") {
      finishNextTrackExit();
    }
  };

  if (loading) return <main id="main" className="shell"><Loading label={t("Party wird geladen …")} /></main>;

  return (
    <div className="guest-page">
      <header className="topbar">
        <Brand />
        <div className="topbar__actions">
          <LanguageSwitcher />
          <button
            ref={spotifyQueueButtonRef}
            className="topbar__queue-button"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={spotifyQueueOpen}
            aria-label={t("Spotify Warteschlange öffnen, {count} Titel", { count: state?.nativeQueue.length ?? 0 })}
            onClick={() => setSpotifyQueueOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h10M4 12h8M4 18h6" />
              <path d="m15 15 4 3-4 3v-6Z" />
            </svg>
            <span className="topbar__queue-label"><small>Spotify</small><strong>Queue</strong></span>
            <span className="topbar__queue-count">{state?.nativeQueue.length ?? 0}</span>
          </button>
        </div>
      </header>
      <main id="main" className="shell shell--guest">
        <div className="guest-alerts">
          {error && <Notice tone="error" live>{error} <button className="inline-button" onClick={() => { setError(null); void load(); }}>{t("Erneut versuchen")}</button></Notice>}
          <SpotifyLimitNotice limit={state?.spotifyRateLimit} />
          {state?.player.warning && !rateLimited && <Notice>{serverMessage(state.player.warning)}</Notice>}
          {message && <Notice tone="success" live>{message}</Notice>}
        </div>
        <div className="party-heading">
          <div>
            <span className={`live-dot ${state?.party.active ? "" : "live-dot--off"}`} aria-hidden="true" />
            <span>{t(state?.party.active ? "Party läuft" : "Party beendet")}</span>
            {state?.party.active && <span className="party-heading__signal" aria-hidden="true"><i /><i /><i /></span>}
          </div>
          <h1>{state?.party.name ?? "Party"}</h1>
          <p>{t("Hier entsteht eure Setlist – Song suchen, wünschen und gemeinsam nach oben voten.")}</p>
        </div>

        <div className="guest-stage">
          <section className={`now-playing ${renderedLockedNext ? "now-playing--with-next" : ""}`} aria-labelledby="now-title">
            <span className="now-playing__on-air" aria-hidden="true"><i />On Air</span>
            <div className="section-kicker" id="now-title">{t("Läuft gerade")}</div>
            {renderedNowPlaying ? (
              <div
                className={`now-playing__current now-track-transition--${currentTrackTransition.phase}`}
                key={renderedNowPlaying.id}
                onAnimationEnd={currentTrackTransition.onAnimationEnd}
              >
                <a href={renderedNowPlaying.spotifyUrl} target="_blank" rel="noreferrer"><Artwork track={renderedNowPlaying} size="hero" /></a>
                <div className="now-playing__content">
                  <TrackMeta track={renderedNowPlaying} />
                  <div className="progress" role="progressbar" aria-label={t("Fortschritt des laufenden Songs")} aria-valuemin={0} aria-valuemax={renderedNowPlaying.durationMs} aria-valuenow={renderedProgressMs}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <div className="progress-label"><span>{formatTime(renderedProgressMs)}</span><span>−{formatTime(renderedNowPlaying.durationMs - renderedProgressMs)}</span></div>
                  <div className="device-label"><span aria-hidden="true">●</span>{state?.player.deviceName ?? t("Kein aktives Gerät")}</div>
                  <SpotifyLink href={renderedNowPlaying.spotifyUrl} />
                </div>
              </div>
            ) : <EmptyState title={t("Noch spielt nichts")}>{t("Starte Spotify auf dem Party-Gerät. Sobald Musik läuft, erscheint sie hier.")}</EmptyState>}
            {renderedLockedNext && (
              <aside
                className={`now-playing__next now-playing__next--${nextTrackPhase}`}
                aria-labelledby="locked-title"
                aria-hidden={nextTrackPhase === "exiting" ? true : undefined}
                onAnimationEnd={handleNextTrackAnimationEnd}
              >
                <span className="section-kicker" id="locked-title">{t("Als Nächstes")}</span>
                <a href={renderedLockedNext.spotifyUrl} target="_blank" rel="noreferrer" tabIndex={nextTrackPhase === "exiting" ? -1 : undefined} aria-label={t("{track} auf Spotify öffnen", { track: renderedLockedNext.name })}><Artwork track={renderedLockedNext} size="small" /></a>
                <TrackMeta track={renderedLockedNext} compact />
                <span className="now-playing__next-state">
                  <svg viewBox="0 0 32 32" aria-hidden="true">
                    <path d="M5 8h12M5 16h9M5 24h7" />
                    <path d="M18 16h8m-4-4 4 4-4 4" />
                  </svg>
                  {t("Fest eingeplant")}
                </span>
              </aside>
            )}
          </section>

          <div className="guest-stage__primary">

            <section className="search-panel" aria-labelledby="search-title">
              <div className="section-title-row"><div><span className="section-kicker">{t("Dein Musikwunsch")}</span><h2 id="search-title">{t("Song finden")}</h2></div><span>{remainingRequests === 0 ? t("Kein Wunsch mehr frei") : t(remainingRequests === 1 ? "{count} Wunsch frei" : "{count} Wünsche frei", { count: remainingRequests })}</span></div>
              <form
                className="search-field"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.currentTarget.querySelector("input")?.blur();
                }}
              >
                <span className="sr-only">{t("Song oder Künstler suchen")}</span>
                <span aria-hidden="true">⌕</span>
                <input aria-label={t("Song oder Künstler suchen")} type="search" enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(rateLimited ? "Spotify-Suche pausiert" : "Song oder Künstler …")} disabled={!state?.party.active || rateLimited} autoComplete="off" />
                {query && <button type="button" onClick={() => setQuery("")} aria-label={t("Suche leeren")}>×</button>}
              </form>
              {requestFeedback && <Notice tone={requestFeedback.tone} live>{requestFeedback.text}</Notice>}
              {search.error && <Notice tone="error">{search.error}</Notice>}
              {search.loading && search.items.length === 0 && <Loading label={t("Spotify wird durchsucht …")} />}
              {query.trim().length >= 2 && !search.loading && search.items.length === 0 && !search.error && <EmptyState title={t("Kein Treffer")}>{t("Versuche einen anderen Songtitel oder Künstlernamen.")}</EmptyState>}
              {search.items.length > 0 && (
                <ul className="search-results" aria-label={t("Spotify Suchergebnisse")}>
                  {search.items.map((track) => (
                    <SearchResult
                      key={track.id}
                      track={track}
                      actionLabel={t("Song wünschen")}
                      onAction={() => void requestTrack(track)}
                      busy={busyId === track.id}
                      unavailable={requestedTrackIds.has(track.id)}
                      unavailableLabel={t("Bereits gewünscht")}
                    />
                  ))}
                </ul>
              )}
              {search.nextOffset !== null && <button className="secondary-button" type="button" onClick={() => void search.more()} disabled={search.loading}>{t("Weitere Ergebnisse")}</button>}
            </section>
          </div>

          <div className="guest-stage__queue">
            <section className="queue-section" aria-labelledby="queue-title">
              <div className="section-title-row"><div><span className="section-kicker">{t("Gemeinsam entscheiden")}</span><h2 id="queue-title">{t("Party Queue")}</h2></div><span>{state?.queue.length ?? 0} {t((state?.queue.length ?? 0) === 1 ? "Song" : "Songs")}</span></div>
              <p className="section-copy">{t("Mehr Stimmen bringen einen Song nach oben. Bei Gleichstand gewinnt der ältere Wunsch.")}</p>
              {state?.queue.length ? (
                <ol className="queue-list">
                  {state.queue.map((item, index) => <QueueRow key={item.queueId} item={item} position={index + 1} onVote={() => void vote(item.queueId)} busy={busyId === item.queueId} />)}
                </ol>
              ) : <EmptyState title={t("Die Queue wartet auf euch")}>{t("Suche nach einem Song und stelle den ersten Musikwunsch.")}</EmptyState>}
            </section>

          </div>
        </div>
      </main>
      <SpotifyQueueDialog open={spotifyQueueOpen} tracks={state?.nativeQueue ?? []} onClose={closeSpotifyQueue} />
      <footer className="footer"><Brand compact /><p>{t("Musikdaten werden von Spotify bereitgestellt.")}</p><a href="/datenschutz">{t("Datenschutz")}</a></footer>
    </div>
  );
}
