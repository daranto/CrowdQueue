import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api } from "./api";
import { Artwork, ExplicitBadge } from "./components";
import { useI18n } from "./i18n";
import type { PartyState, Track } from "./types";
import { useTrackTransition } from "./useTrackTransition";

interface WallCue {
  key: string;
  track: Track;
  label: string;
  detail: string;
  locked: boolean;
}

const MAX_RESPONSIVE_CUES = 6;
const WALL_PROGRESS_ARC_DEGREES = 360;
const MIN_WALL_COPY_SCALE = 0.16;
const MIN_WALL_COPY_HEIGHT = 72;

function buildCues(state: PartyState, t: (key: string, values?: Record<string, string | number>) => string): WallCue[] {
  const cues: WallCue[] = [];
  const seen = new Set(state.nowPlaying ? [state.nowPlaying.id] : []);
  const append = (track: Track, label: string, detail: string, locked = false) => {
    if (seen.has(track.id)) return;
    seen.add(track.id);
    cues.push({ key: `${label}-${track.id}`, track, label, detail, locked });
  };

  if (state.lockedNext) append(state.lockedNext, t("Als Nächstes"), t("Fest eingeplant"), true);
  state.queue.forEach((track) => append(
    track,
    t("Musikwunsch"),
    `${track.score} ${t(track.score === 1 ? "Stimme" : "Stimmen")}`,
  ));
  return cues;
}

export function DisplayWallApp({ code }: { code: string }) {
  const { t } = useI18n();
  const [state, setState] = useState<PartyState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [cueCapacity, setCueCapacity] = useState(3);
  const lineupRef = useRef<HTMLElement>(null);
  const wallLayoutRef = useRef<HTMLDivElement>(null);
  const wallArtRingRef = useRef<HTMLDivElement>(null);
  const wallCopyRef = useRef<HTMLDivElement>(null);
  const wallTitleRef = useRef<HTMLHeadingElement>(null);
  const wallArtistRef = useRef<HTMLParagraphElement>(null);
  const currentTrackTransition = useTrackTransition(state?.nowPlaying ?? null);

  const load = useCallback(async () => {
    try {
      setState(await api<PartyState>(`/api/parties/${code}/state`));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("Display Wall konnte nicht geladen werden."));
    } finally {
      setLoading(false);
    }
  }, [code, t]);

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
  const progressMs = useMemo(() => {
    if (!state?.nowPlaying) return 0;
    const measuredAt = Date.parse(state.player.updatedAt);
    const elapsed = state.player.isPlaying && Number.isFinite(measuredAt) ? Math.max(0, clock - measuredAt) : 0;
    return Math.min(state.nowPlaying.durationMs, state.player.progressMs + elapsed);
  }, [clock, state]);
  const renderedNowPlaying = currentTrackTransition.renderedTrack;
  const renderedProgressMs = renderedNowPlaying?.id === state?.nowPlaying?.id
    ? progressMs
    : renderedNowPlaying?.durationMs ?? 0;
  const progress = renderedNowPlaying?.durationMs ? Math.min(100, renderedProgressMs / renderedNowPlaying.durationMs * 100) : 0;
  const cues = useMemo(() => state ? buildCues(state, t) : [], [state, t]);
  const visibleCues = cues.slice(0, cueCapacity);
  const wallStyle = {
    "--wall-progress-angle": `${progress * WALL_PROGRESS_ARC_DEGREES / 100}deg`,
  } as CSSProperties;

  useEffect(() => {
    const panel = lineupRef.current;
    if (!panel || cues.length === 0) return;
    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const list = panel.querySelector<HTMLOListElement>(".wall-lineup__list");
        const item = list?.querySelector<HTMLElement>(".wall-lineup__item");
        if (!list || !item) return;
        const listHeight = list.getBoundingClientRect().height;
        const itemHeight = item.getBoundingClientRect().height;
        const parsedGap = Number.parseFloat(window.getComputedStyle(list).rowGap);
        const gap = Number.isFinite(parsedGap) ? parsedGap : 8;
        const capacity = Math.floor((listHeight + gap) / (itemHeight + gap));
        setCueCapacity(Math.max(1, Math.min(MAX_RESPONSIVE_CUES, capacity)));
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    const list = panel.querySelector<HTMLOListElement>(".wall-lineup__list");
    if (list) observer.observe(list);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.cancelAnimationFrame(frame);
    };
  }, [cues.length, qrDataUrl]);

  useLayoutEffect(() => {
    const layout = wallLayoutRef.current;
    const artRing = wallArtRingRef.current;
    const copy = wallCopyRef.current;
    const title = wallTitleRef.current;
    const artist = wallArtistRef.current;
    if (!layout || !artRing || !copy || !title || !artist || !renderedNowPlaying) return;

    let active = true;
    let frame = 0;
    const fitCopy = () => {
      if (!active) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (!active) return;
        copy.style.removeProperty("--wall-copy-fit-top");
        copy.style.removeProperty("--wall-title-fit-size");
        copy.style.removeProperty("--wall-artist-fit-size");

        const copyStyle = window.getComputedStyle(copy);
        const artStyle = window.getComputedStyle(artRing);
        const titleSize = Number.parseFloat(window.getComputedStyle(title).fontSize);
        const artistSize = Number.parseFloat(window.getComputedStyle(artist).fontSize);
        const progressInset = Number.parseFloat(artStyle.getPropertyValue("--wall-progress-inset"));
        const progressGap = Number.parseFloat(copyStyle.getPropertyValue("--wall-copy-progress-gap"));
        const edgeGap = Number.parseFloat(copyStyle.getPropertyValue("--wall-copy-edge-gap"));
        const insetRatio = Number.isFinite(progressInset) ? progressInset / 100 : 0.27;
        const gap = Number.isFinite(progressGap) ? progressGap : 24;
        const minimumTop = Number.isFinite(edgeGap) ? edgeGap : 24;
        const progressTop = artRing.offsetTop - artRing.offsetHeight / 2 + artRing.offsetHeight * insetRatio;
        const desiredTop = copy.offsetTop;
        const fittedTop = Math.max(minimumTop, Math.min(desiredTop, progressTop - gap - MIN_WALL_COPY_HEIGHT));
        const safeHeight = Math.max(1, progressTop - fittedTop - gap);

        copy.style.setProperty("--wall-copy-fit-top", `${fittedTop}px`);
        copy.style.setProperty("--wall-copy-safe-height", `${safeHeight}px`);

        const applyScale = (scale: number) => {
          copy.style.setProperty("--wall-title-fit-size", `${titleSize * scale}px`);
          copy.style.setProperty("--wall-artist-fit-size", `${artistSize * scale}px`);
        };
        const fits = () => {
          const copyBounds = copy.getBoundingClientRect();
          const titleBounds = title.getBoundingClientRect();
          const artistBounds = artist.getBoundingClientRect();
          return Math.max(titleBounds.bottom, artistBounds.bottom) <= copyBounds.bottom
            && Math.min(titleBounds.left, artistBounds.left) >= copyBounds.left
            && Math.max(titleBounds.right, artistBounds.right) <= copyBounds.right;
        };

        let fittedScale = 1;
        applyScale(fittedScale);
        if (!fits()) {
          let lower = MIN_WALL_COPY_SCALE;
          let upper = 1;
          applyScale(lower);
          for (let iteration = 0; iteration < 12; iteration += 1) {
            const candidate = (lower + upper) / 2;
            applyScale(candidate);
            if (fits()) lower = candidate;
            else upper = candidate;
          }
          fittedScale = lower;
          applyScale(fittedScale);
        }
        copy.dataset.fitScale = fittedScale.toFixed(3);
      });
    };

    const resizeObserver = new ResizeObserver(fitCopy);
    const contentObserver = new MutationObserver(fitCopy);
    resizeObserver.observe(layout);
    resizeObserver.observe(artRing);
    contentObserver.observe(copy, { childList: true, characterData: true, subtree: true });
    void document.fonts.ready.then(fitCopy);
    document.fonts.addEventListener("loadingdone", fitCopy);
    window.addEventListener("resize", fitCopy);
    fitCopy();

    return () => {
      active = false;
      resizeObserver.disconnect();
      contentObserver.disconnect();
      document.fonts.removeEventListener("loadingdone", fitCopy);
      window.removeEventListener("resize", fitCopy);
      window.cancelAnimationFrame(frame);
    };
  }, [renderedNowPlaying]);

  if (loading) {
    return <main id="main" className="display-wall display-wall--message"><span className="display-wall__pulse" /><p>{t("Display Wall wird verbunden …")}</p></main>;
  }

  if (!state) {
    return <main id="main" className="display-wall display-wall--message"><span className="section-kicker">Display Wall</span><h1>{t("Party nicht gefunden.")}</h1><p>{error ?? t("Prüfe den Display-Link und lade die Seite erneut.")}</p></main>;
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
            <span>{t(state.party.active ? "Party läuft" : "Party beendet")}</span>
            <strong>{state.party.name}</strong>
          </div>
        </header>

        <main id="main" className="display-wall__stage">
          <section className="wall-now" aria-labelledby="wall-current-title">
            <div className="wall-now__status">
              <span className={state.player.isPlaying ? "wall-now__on-air" : "wall-now__on-air wall-now__on-air--paused"}><i />{state.player.isPlaying ? "On Air" : t("Pausiert")}</span>
            </div>
            {renderedNowPlaying ? (
              <div
                ref={wallLayoutRef}
                className={`wall-now__layout now-track-transition--${currentTrackTransition.phase}`}
                key={renderedNowPlaying.id}
                onAnimationEnd={currentTrackTransition.onAnimationEnd}
              >
                <div ref={wallArtRingRef} className="wall-now__art-ring" role="progressbar" aria-label={t("Fortschritt des laufenden Songs")} aria-valuemin={0} aria-valuemax={renderedNowPlaying.durationMs} aria-valuenow={Math.round(renderedProgressMs)}>
                  <div className={`wall-now__vinyl ${state.player.isPlaying ? "wall-now__vinyl--spinning" : "wall-now__vinyl--paused"}`}>
                    <Artwork track={renderedNowPlaying} size="hero" />
                  </div>
                </div>
                <div ref={wallCopyRef} className="wall-now__copy">
                  <h1 ref={wallTitleRef} id="wall-current-title">{renderedNowPlaying.name} {renderedNowPlaying.explicit && <ExplicitBadge />}</h1>
                  <p ref={wallArtistRef}>{renderedNowPlaying.artists}</p>
                </div>
              </div>
            ) : (
              <div className="wall-now__empty">
                <span aria-hidden="true">♫</span>
                <div><h1 id="wall-current-title">{t("Noch spielt nichts")}.</h1><p>{t("Sobald die Wiedergabe startet, erscheint der Titel hier.")}</p></div>
              </div>
            )}
          </section>

          <section ref={lineupRef} className={`wall-lineup ${visibleCues.length ? "" : "wall-lineup--invite"}`} aria-labelledby="wall-lineup-title">
            {visibleCues.length ? (
              <>
                <div className="wall-lineup__heading">
                  <div><span className="section-kicker">{t("Musikwünsche")}</span><h2 id="wall-lineup-title">{t("Nächste Tracks")}</h2></div>
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
                  <div className="wall-lineup__scan">
                    {qrDataUrl ? <img src={qrDataUrl} alt={t("QR-Code für Musikwünsche bei {party}", { party: state.party.name })} /> : <i aria-hidden="true" />}
                    <span><strong>{t("Song wünschen")}</strong></span>
                  </div>
                </div>
              </>
            ) : (
              <div className="wall-lineup__invite">
                {qrDataUrl ? <img src={qrDataUrl} alt={t("QR-Code für Musikwünsche bei {party}", { party: state.party.name })} /> : <span className="wall-lineup__qr-placeholder" aria-hidden="true" />}
                <div><span className="section-kicker">{t("Jetzt mitbestimmen")}</span><h2 id="wall-lineup-title">{t("Song wünschen")}</h2><p>{t("Scanne den Party-Code. Der erste Wunsch erscheint automatisch hier.")}</p></div>
              </div>
            )}
          </section>
        </main>

      </div>
    </div>
  );
}
