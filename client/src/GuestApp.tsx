import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, formatTime } from "./api";
import { Artwork, Brand, EmptyState, Loading, Notice, QueueRow, SearchResult, SpotifyLimitNotice, SpotifyLink, TrackMeta } from "./components";
import type { PartyState, Track } from "./types";
import { useSearch } from "./useSearch";

export function GuestApp({ code }: { code: string }) {
  const [state, setState] = useState<PartyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [requestFeedback, setRequestFeedback] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | number | null>(null);
  const [progressClock, setProgressClock] = useState(() => Date.now());
  const rateLimited = state?.spotifyRateLimit.limited ?? false;
  const search = useSearch(`/api/parties/${code}/search`, rateLimited ? "" : query);

  const load = useCallback(async (announce = false) => {
    try {
      const next = await api<PartyState>(`/api/parties/${code}/state`);
      setState(next);
      setError(null);
      if (announce) setMessage("Warteschlange aktualisiert.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Party konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { void load(); }, [load]);
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
          ? `${track.name} wurde gewünscht.`
          : result.voted
            ? `Deine Stimme für ${track.name} wurde gezählt.`
            : `${track.name} ist bereits in der Queue.`,
      });
      await load();
    } catch (caught) {
      setRequestFeedback({
        tone: "error",
        text: caught instanceof Error ? caught.message : "Musikwunsch fehlgeschlagen.",
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
      setError(caught instanceof Error ? caught.message : "Abstimmung fehlgeschlagen.");
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
  const progress = state?.nowPlaying?.durationMs ? Math.min(100, estimatedProgressMs / state.nowPlaying.durationMs * 100) : 0;

  const remainingRequests = Math.max(0, (state?.limits.maxOpenRequests ?? 3) - (state?.limits.ownOpenRequests ?? 0));
  const requestedTrackIds = useMemo(() => {
    const ids = new Set(state?.queue.map((item) => item.id) ?? []);
    if (state?.lockedNext) ids.add(state.lockedNext.id);
    return ids;
  }, [state]);

  if (loading) return <main id="main" className="shell"><Loading label="Party wird geladen …" /></main>;

  return (
    <div className="guest-page">
      <header className="topbar">
        <Brand />
      </header>
      <main id="main" className="shell shell--guest">
        <div className="guest-alerts">
          {error && <Notice tone="error" live>{error} <button className="inline-button" onClick={() => { setError(null); void load(); }}>Erneut versuchen</button></Notice>}
          <SpotifyLimitNotice limit={state?.spotifyRateLimit} />
          {state?.player.warning && !rateLimited && <Notice>{state.player.warning}</Notice>}
          {message && <Notice tone="success" live>{message}</Notice>}
        </div>
        <div className="party-heading">
          <div><span className={`live-dot ${state?.party.active ? "" : "live-dot--off"}`} aria-hidden="true" /><span>{state?.party.active ? "Party läuft" : "Party beendet"}</span></div>
          <h1>{state?.party.name ?? "Party"}</h1>
          <p>Hier entsteht eure Setlist – Song suchen, wünschen und gemeinsam nach oben voten.</p>
        </div>

        <div className={`guest-stage ${state?.lockedNext ? "guest-stage--with-next" : ""}`}>
          <section className={`now-playing ${state?.lockedNext ? "now-playing--with-next" : ""}`} aria-labelledby="now-title">
            <span className="now-playing__on-air" aria-hidden="true"><i />On Air</span>
            <div className="section-kicker" id="now-title">Läuft gerade</div>
            {state?.nowPlaying ? (
              <>
                <a href={state.nowPlaying.spotifyUrl} target="_blank" rel="noreferrer"><Artwork track={state.nowPlaying} size="hero" /></a>
                <div className="now-playing__content">
                  <TrackMeta track={state.nowPlaying} />
                  <div className="progress" role="progressbar" aria-label="Fortschritt des laufenden Songs" aria-valuemin={0} aria-valuemax={state.nowPlaying.durationMs} aria-valuenow={estimatedProgressMs}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <div className="progress-label"><span>{formatTime(estimatedProgressMs)}</span><span>−{formatTime(state.nowPlaying.durationMs - estimatedProgressMs)}</span></div>
                  <div className="device-label"><span aria-hidden="true">●</span>{state.player.deviceName ?? "Kein aktives Gerät"}</div>
                  <SpotifyLink href={state.nowPlaying.spotifyUrl} />
                </div>
              </>
            ) : <EmptyState title="Noch spielt nichts">Starte Spotify auf dem Party-Gerät. Sobald Musik läuft, erscheint sie hier.</EmptyState>}
            {state?.lockedNext && (
              <aside className="now-playing__next" aria-labelledby="locked-title">
                <span className="section-kicker" id="locked-title">Als Nächstes</span>
                <a href={state.lockedNext.spotifyUrl} target="_blank" rel="noreferrer" aria-label={`${state.lockedNext.name} auf Spotify öffnen`}><Artwork track={state.lockedNext} size="small" /></a>
                <TrackMeta track={state.lockedNext} compact />
                <span className="now-playing__next-state">
                  <svg viewBox="0 0 32 32" aria-hidden="true">
                    <path d="M5 8h12M5 16h9M5 24h7" />
                    <path d="M18 16h8m-4-4 4 4-4 4" />
                  </svg>
                  Fest eingeplant
                </span>
              </aside>
            )}
          </section>

          <div className="guest-stage__primary">

            <section className="search-panel" aria-labelledby="search-title">
              <div className="section-title-row"><div><span className="section-kicker">Dein Musikwunsch</span><h2 id="search-title">Song finden</h2></div><span>{remainingRequests === 0 ? "Kein Wunsch mehr frei" : `${remainingRequests} ${remainingRequests === 1 ? "Wunsch" : "Wünsche"} frei`}</span></div>
              <form
                className="search-field"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.currentTarget.querySelector("input")?.blur();
                }}
              >
                <span className="sr-only">Song oder Künstler suchen</span>
                <span aria-hidden="true">⌕</span>
                <input aria-label="Song oder Künstler suchen" type="search" enterKeyHint="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={rateLimited ? "Spotify-Suche pausiert" : "Song oder Künstler …"} disabled={!state?.party.active || rateLimited} autoComplete="off" />
                {query && <button type="button" onClick={() => setQuery("")} aria-label="Suche leeren">×</button>}
              </form>
              {requestFeedback && <Notice tone={requestFeedback.tone} live>{requestFeedback.text}</Notice>}
              {search.error && <Notice tone="error">{search.error}</Notice>}
              {search.loading && search.items.length === 0 && <Loading label="Spotify wird durchsucht …" />}
              {query.trim().length >= 2 && !search.loading && search.items.length === 0 && !search.error && <EmptyState title="Kein Treffer">Versuche einen anderen Songtitel oder Künstlernamen.</EmptyState>}
              {search.items.length > 0 && (
                <ul className="search-results" aria-label="Spotify Suchergebnisse">
                  {search.items.map((track) => (
                    <SearchResult
                      key={track.id}
                      track={track}
                      actionLabel="Song wünschen"
                      onAction={() => void requestTrack(track)}
                      busy={busyId === track.id}
                      unavailable={requestedTrackIds.has(track.id)}
                      unavailableLabel="Bereits gewünscht"
                    />
                  ))}
                </ul>
              )}
              {search.nextOffset !== null && <button className="secondary-button" type="button" onClick={() => void search.more()} disabled={search.loading}>Weitere Ergebnisse</button>}
            </section>
          </div>

          <div className="guest-stage__queue">
            <section className="queue-section" aria-labelledby="queue-title">
              <div className="section-title-row"><div><span className="section-kicker">Gemeinsam entscheiden</span><h2 id="queue-title">Party Queue</h2></div><span>{state?.queue.length ?? 0} {(state?.queue.length ?? 0) === 1 ? "Song" : "Songs"}</span></div>
              <p className="section-copy">Mehr Stimmen bringen einen Song nach oben. Bei Gleichstand gewinnt der ältere Wunsch.</p>
              {state?.queue.length ? (
                <ol className="queue-list">
                  {state.queue.map((item, index) => <QueueRow key={item.queueId} item={item} position={index + 1} onVote={() => void vote(item.queueId)} busy={busyId === item.queueId} />)}
                </ol>
              ) : <EmptyState title="Die Queue wartet auf euch">Suche nach einem Song und stelle den ersten Musikwunsch.</EmptyState>}
            </section>

            <details className="native-queue">
              <summary><span><span className="section-kicker">Schreibgeschützt</span><strong>Spotify Warteschlange</strong></span><span aria-hidden="true">⌄</span></summary>
              <p>Diese Titel wurden direkt in Spotify vorgemerkt und können hier nicht umsortiert werden.</p>
              {state?.nativeQueue.length ? <ol>{state.nativeQueue.map((track, index) => <li key={`${track.id}-${index}`}><span>{index + 1}</span><TrackMeta track={track} compact /></li>)}</ol> : <p>Noch keine weiteren Spotify-Titel vorgemerkt.</p>}
            </details>
          </div>
        </div>
      </main>
      <footer className="footer"><Brand compact /><p>Musikdaten werden von Spotify bereitgestellt.</p><a href="/datenschutz">Datenschutz</a></footer>
    </div>
  );
}
