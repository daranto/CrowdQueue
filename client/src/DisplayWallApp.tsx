import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "./api";
import { Artwork, ExplicitBadge } from "./components";
import type { PartyState, Track } from "./types";

interface WallCue {
  key: string;
  track: Track;
  label: string;
  detail: string;
  locked: boolean;
}

function visibleCueLimit(): number {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width < 560) return height < 740 ? 2 : 3;
  if (width < 900) return 4;
  if (width < 1350 || height < 800) return 5;
  if (width >= 1900 && height >= 1000) return 7;
  return 6;
}

function buildCues(state: PartyState): WallCue[] {
  const cues: WallCue[] = [];
  const seen = new Set(state.nowPlaying ? [state.nowPlaying.id] : []);
  const append = (track: Track, label: string, detail: string, locked = false) => {
    if (seen.has(track.id)) return;
    seen.add(track.id);
    cues.push({ key: `${label}-${track.id}`, track, label, detail, locked });
  };

  if (state.lockedNext) append(state.lockedNext, "Als Nächstes", "Fest eingeplant", true);
  state.queue.forEach((track) => append(
    track,
    "Musikwunsch",
    `${track.score} ${track.score === 1 ? "Stimme" : "Stimmen"}`,
  ));
  return cues;
}

export function DisplayWallApp({ code }: { code: string }) {
  const [state, setState] = useState<PartyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [cueLimit, setCueLimit] = useState(visibleCueLimit);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api<PartyState>(`/api/parties/${code}/state`));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Display Wall konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const events = new EventSource(`/api/parties/${code}/events`);
    const refresh = () => void load();
    events.addEventListener("state", refresh);
    events.addEventListener("ended", refresh);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void load();
    }, 30000);
    const resume = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("pageshow", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      events.close();
      window.clearInterval(poll);
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [code, load]);
  useEffect(() => {
    if (!state?.player.isPlaying || !state.nowPlaying) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state?.nowPlaying, state?.player.isPlaying]);
  useEffect(() => {
    let active = true;
    if (!state?.party.guestUrl) {
      setQrDataUrl(null);
      return;
    }
    void import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(state.party.guestUrl, {
      width: 900,
      margin: 3,
      errorCorrectionLevel: "H",
      color: { dark: "#17152f", light: "#ffffff" },
    })).then((url) => {
      if (active) setQrDataUrl(url);
    }).catch(() => {
      if (active) setQrDataUrl(null);
    });
    return () => { active = false; };
  }, [state?.party.guestUrl]);
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setCueLimit(visibleCueLimit()));
    };
    window.addEventListener("resize", resize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  const progressMs = useMemo(() => {
    if (!state?.nowPlaying) return 0;
    const measuredAt = Date.parse(state.player.updatedAt);
    const elapsed = state.player.isPlaying && Number.isFinite(measuredAt) ? Math.max(0, clock - measuredAt) : 0;
    return Math.min(state.nowPlaying.durationMs, state.player.progressMs + elapsed);
  }, [clock, state]);
  const progress = state?.nowPlaying?.durationMs ? Math.min(100, progressMs / state.nowPlaying.durationMs * 100) : 0;
  const cues = useMemo(() => state ? buildCues(state) : [], [state]);
  const visibleCues = cues.slice(0, cueLimit);
  const hiddenCueCount = Math.max(0, cues.length - visibleCues.length);
  const wallStyle = { "--wall-progress-angle": `${progress * 3.6}deg` } as CSSProperties;

  if (loading) {
    return <main id="main" className="display-wall display-wall--message"><span className="display-wall__pulse" /><p>Display Wall wird verbunden …</p></main>;
  }

  if (!state) {
    return <main id="main" className="display-wall display-wall--message"><span className="section-kicker">Display Wall</span><h1>Party nicht gefunden.</h1><p>{error ?? "Prüfe den Display-Link und lade die Seite erneut."}</p></main>;
  }

  return (
    <div className="display-wall-page" style={wallStyle}>
      <div className="display-wall">
        <header className="display-wall__header">
          <div className="wall-brand" aria-label="CrowdQueue">
            <span className="brand__mark" aria-hidden="true"><i /><i /><i /></span>
            <span>Crowd<span>Queue</span></span>
          </div>
          <div className="display-wall__party">
            <span className={`live-dot ${state.party.active ? "" : "live-dot--off"}`} aria-hidden="true" />
            <span>{state.party.active ? "Party läuft" : "Party beendet"}</span>
            <strong>{state.party.name}</strong>
          </div>
          <span className={`display-wall__connection ${error ? "display-wall__connection--off" : ""}`} role="status">
            {error ? "Verbindung wird erneuert" : "Live verbunden"}
          </span>
        </header>

        <main id="main" className="display-wall__stage">
          <section className="wall-now" aria-labelledby="wall-current-title">
            <div className="wall-now__status">
              <span className="section-kicker">Läuft gerade</span>
              <span className={state.player.isPlaying ? "wall-now__on-air" : "wall-now__on-air wall-now__on-air--paused"}><i />{state.player.isPlaying ? "On Air" : "Pausiert"}</span>
            </div>
            {state.nowPlaying ? (
              <div className="wall-now__layout" key={state.nowPlaying.id}>
                <div className="wall-now__art-ring" role="progressbar" aria-label="Fortschritt des laufenden Songs" aria-valuemin={0} aria-valuemax={state.nowPlaying.durationMs} aria-valuenow={Math.round(progressMs)}>
                  <Artwork track={state.nowPlaying} size="hero" />
                </div>
                <div className="wall-now__copy">
                  <h1 id="wall-current-title">{state.nowPlaying.name} {state.nowPlaying.explicit && <ExplicitBadge />}</h1>
                  <p>{state.nowPlaying.artists}<span> · </span>{state.nowPlaying.album}</p>
                </div>
              </div>
            ) : (
              <div className="wall-now__empty">
                <span aria-hidden="true">♫</span>
                <div><h1 id="wall-current-title">Noch spielt nichts.</h1><p>Sobald die Wiedergabe startet, erscheint der Titel hier.</p></div>
              </div>
            )}
          </section>

          <section className={`wall-lineup ${visibleCues.length ? "" : "wall-lineup--invite"}`} aria-labelledby="wall-lineup-title">
            {visibleCues.length ? (
              <>
                <div className="wall-lineup__heading">
                  <div><span className="section-kicker">Musikwünsche</span><h2 id="wall-lineup-title">Nächste Tracks</h2></div>
                  <span>{cues.length}</span>
                </div>
                <ol className="wall-lineup__list">
                {visibleCues.map((cue, index) => (
                  <li className={`wall-lineup__item ${cue.locked ? "wall-lineup__item--locked" : ""}`} key={cue.key}>
                    <span className="wall-lineup__position">{String(index + 1).padStart(2, "0")}</span>
                    <Artwork track={cue.track} size="small" />
                    <div className="wall-lineup__track">
                      <strong>{cue.track.name} {cue.track.explicit && <ExplicitBadge />}</strong>
                      <span>{cue.track.artists} · {cue.track.album}</span>
                    </div>
                    <div className="wall-lineup__cue"><span>{cue.label}</span><small>{cue.detail}</small></div>
                  </li>
                ))}
                </ol>
                <div className="wall-lineup__footer">
                  <p className="wall-lineup__more">{hiddenCueCount > 0 ? `+ ${hiddenCueCount} weitere ${hiddenCueCount === 1 ? "Titel wartet" : "Titel warten"}` : "Live nach Stimmen sortiert"}</p>
                  <div className="wall-lineup__scan">
                    <span><strong>Song wünschen</strong><small>Party-Code scannen</small></span>
                    {qrDataUrl ? <img src={qrDataUrl} alt={`QR-Code für Musikwünsche bei ${state.party.name}`} /> : <i aria-hidden="true" />}
                  </div>
                </div>
              </>
            ) : (
              <div className="wall-lineup__invite">
                {qrDataUrl ? <img src={qrDataUrl} alt={`QR-Code für Musikwünsche bei ${state.party.name}`} /> : <span className="wall-lineup__qr-placeholder" aria-hidden="true" />}
                <div><span className="section-kicker">Jetzt mitbestimmen</span><h2 id="wall-lineup-title">Song wünschen</h2><p>Scanne den Party-Code. Der erste Wunsch erscheint automatisch hier.</p></div>
              </div>
            )}
          </section>
        </main>

        <footer className="display-wall__footer">
          <span>Nur Anzeige · Aktualisiert sich automatisch</span>
          <span><i aria-hidden="true" />{state.player.deviceName ?? "Kein aktives Spotify-Gerät"}</span>
        </footer>
      </div>
    </div>
  );
}
