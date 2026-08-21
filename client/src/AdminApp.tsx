import { useCallback, useEffect, useState } from "react";
import { ApiError, api, formatTime } from "./api";
import { Artwork, Brand, EmptyState, Loading, Notice, QueueRow, SpotifyLimitNotice, TrackMeta } from "./components";
import { QrExportDialog } from "./QrExportDialog";
import { StatisticsPanel } from "./StatisticsPanel";
import type { AdminState, ApiStatistics, StatisticsRange } from "./types";

export function AdminApp() {
  const [state, setState] = useState<AdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState<"public" | "lan">("lan");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState<string | number | null>(null);
  const [qrExportOpen, setQrExportOpen] = useState(false);
  const [playerClock, setPlayerClock] = useState(() => Date.now());
  const [statistics, setStatistics] = useState<ApiStatistics | null>(null);
  const [statisticsRange, setStatisticsRange] = useState<StatisticsRange>("24h");
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [statisticsError, setStatisticsError] = useState<string | null>(null);
  const rateLimited = state?.spotifyRateLimit?.limited ?? false;
  const spotifyConnected = state?.spotify?.connected ?? state?.connected ?? false;
  const spotifyUnavailable = rateLimited || !spotifyConnected;
  const demoMode = state?.demoMode ?? false;
  const authenticated = state?.authenticated ?? false;
  const oauthError = new URLSearchParams(window.location.search).get("error");
  const oauthErrorMessage = oauthError === "falsches_konto"
    ? "Dieses Spotify-Konto ist nicht als Besitzer hinterlegt. Bitte melde dich mit dem ursprünglichen Admin-Konto an."
    : oauthError === "spotify_abgebrochen"
      ? "Die Spotify-Anmeldung wurde abgebrochen."
      : null;

  const load = useCallback(async () => {
    try {
      const next = await api<AdminState>("/api/admin/state", demoMode ? { headers: { "x-demo-admin": "true" } } : undefined);
      setState((previous) => next.authenticated && previous?.authenticated
        ? { ...next, devices: previous.devices }
        : next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Adminbereich konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  const loadStatistics = useCallback(async () => {
    if (!authenticated) return;
    setStatisticsLoading(true);
    try {
      const headers = demoMode ? { "x-demo-admin": "true" } : undefined;
      setStatistics(await api<ApiStatistics>(`/api/admin/statistics?range=${statisticsRange}`, { headers }));
      setStatisticsError(null);
    } catch (caught) {
      setStatisticsError(caught instanceof Error ? caught.message : "Statistik konnte nicht geladen werden.");
    } finally {
      setStatisticsLoading(false);
    }
  }, [authenticated, demoMode, statisticsRange]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setPlayerClock(Date.now());
    if (!state?.party?.player.isPlaying || !state.party.nowPlaying) return;
    const timer = window.setInterval(() => setPlayerClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state?.party?.nowPlaying, state?.party?.player.isPlaying]);
  useEffect(() => { void loadStatistics(); }, [loadStatistics]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void loadStatistics();
    }, 60000);
    return () => window.clearInterval(timer);
  }, [loadStatistics]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) void load();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!state?.party?.party.code) return;
    const events = new EventSource(`/api/parties/${state.party.party.code}/events`);
    events.addEventListener("state", () => void load());
    events.addEventListener("ended", () => void load());
    return () => events.close();
  }, [load, state?.party?.party.code]);

  function adminInit(method: string, body?: unknown): RequestInit {
    return {
      method,
      headers: {
        "x-csrf-token": state?.csrfToken ?? "",
        ...(state?.demoMode ? { "x-demo-admin": "true" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
  }

  async function action(key: string | number, url: string, method = "POST", body?: unknown, success?: string) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      await api(url, adminInit(method, body));
      if (success) setMessage(success);
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 429 || caught.reason === "invalid_grant")) await load();
      setError(caught instanceof Error ? caught.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  async function createParty(event: React.FormEvent) {
    event.preventDefault();
    await action("create", "/api/admin/parties", "POST", { name, origin }, "Party wurde erstellt.");
    setName("");
  }

  async function refreshDevices() {
    setBusy("refresh-devices");
    setError(null);
    setMessage(null);
    try {
      const result = await api<{ devices: NonNullable<AdminState["devices"]> }>("/api/admin/devices/refresh", adminInit("POST"));
      setState((current) => current ? { ...current, devices: result.devices } : current);
      setMessage(result.devices.length ? "Geräteliste aktualisiert." : "Spotify hat aktuell keine Geräte gemeldet.");
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 429 || caught.reason === "invalid_grant")) await load();
      setError(caught instanceof Error ? caught.message : "Geräteliste konnte nicht aktualisiert werden.");
    } finally {
      setBusy(null);
    }
  }

  async function login() {
    setBusy("login");
    setError(null);
    try {
      const result = await api<{ url: string }>("/api/admin/spotify/login", {
        method: "POST",
        body: JSON.stringify({ setupToken: state?.setupRequired ? setupToken : undefined }),
      });
      window.location.assign(result.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Spotify-Anmeldung konnte nicht gestartet werden.");
      setBusy(null);
    }
  }

  const currentTrack = state?.party?.nowPlaying ?? null;
  const measuredAt = state?.party ? Date.parse(state.party.player.updatedAt) : Number.NaN;
  const elapsed = state?.party?.player.isPlaying && Number.isFinite(measuredAt) ? Math.max(0, playerClock - measuredAt) : 0;
  const playerProgressMs = currentTrack ? Math.min(currentTrack.durationMs, (state?.party?.player.progressMs ?? 0) + elapsed) : 0;
  const playerProgress = currentTrack?.durationMs ? Math.min(100, playerProgressMs / currentTrack.durationMs * 100) : 0;

  async function togglePlayback() {
    if (!state?.party) return;
    const nextIsPlaying = !state.party.player.isPlaying;
    setBusy("player-toggle");
    setError(null);
    setMessage(null);
    setState((current) => current?.party ? {
      ...current,
      party: {
        ...current.party,
        player: {
          ...current.party.player,
          isPlaying: nextIsPlaying,
          progressMs: Math.round(playerProgressMs),
          updatedAt: new Date().toISOString(),
        },
      },
    } : current);
    try {
      await api(nextIsPlaying ? "/api/admin/player/resume" : "/api/admin/player/pause", adminInit("POST"));
    } catch (caught) {
      await load();
      setError(caught instanceof Error ? caught.message : "Wiedergabe konnte nicht gesteuert werden.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <main id="main" className="shell"><Loading label="Adminbereich wird geladen …" /></main>;

  if (!state?.authenticated) {
    const setupRequired = state?.setupRequired ?? true;
    return (
      <div className="admin-page">
        <header className="topbar"><Brand /></header>
        <main id="main" className="auth-card">
          <span className="section-kicker">Party-Zentrale</span>
          <h1>{setupRequired ? "Admin verbinden" : "Admin anmelden"}</h1>
          <p>{setupRequired
            ? "Verbinde einmalig das Spotify-Premium-Konto, das die Musik auf deinem Connect-Gerät abspielt."
            : "Melde dich mit dem bereits hinterlegten Spotify-Admin-Konto an."}</p>
          {!state?.configured && <Notice tone="error">In der Serverkonfiguration fehlen Spotify Client ID oder Client Secret.</Notice>}
          {(error || oauthErrorMessage) && <Notice tone="error">{error ?? oauthErrorMessage}</Notice>}
          <SpotifyLimitNotice limit={state?.spotifyRateLimit} />
          {setupRequired && <label><span>Einmaliges Setup-Token</span><input type="password" value={setupToken} onChange={(event) => setSetupToken(event.target.value)} autoComplete="one-time-code" /></label>}
          <button className="primary-button" type="button" onClick={() => void login()} disabled={!state?.configured || rateLimited || busy === "login" || Boolean(setupRequired && !setupToken)}>{busy === "login" ? "Anmeldung wird gestartet …" : setupRequired ? "Mit Spotify verbinden" : "Mit Spotify anmelden"}</button>
          <p className="fine-print">{setupRequired
            ? "Das Setup-Token wird nur beim allerersten Verbinden benötigt. Danach bleibt ausschließlich dieses Spotify-Konto als Besitzer hinterlegt."
            : "Nur das ursprünglich eingerichtete Spotify-Konto erhält Zugriff auf die Admin-Konsole."}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <header className="topbar"><Brand /><div className="admin-user"><span>{state.spotify?.displayName ?? "Admin"}</span><button type="button" className="text-link" onClick={() => void action("logout", "/api/admin/logout", "POST")}>Abmelden</button></div></header>
      <main id="main" className="admin-shell">
        <div className="admin-heading"><div><span className="section-kicker">Party-Zentrale</span><h1>Admin</h1></div><span className={`admin-status${spotifyConnected ? "" : " admin-status--off"}`}><i /> {spotifyConnected ? "Spotify verbunden" : "Spotify getrennt"}</span></div>
        {error && <Notice tone="error" live>{error}</Notice>}
        {message && <Notice tone="success" live>{message}</Notice>}
        <SpotifyLimitNotice limit={state.spotifyRateLimit} />
        {!spotifyConnected && <Notice tone="error"><strong>Die Spotify-Verbindung ist abgelaufen.</strong> Verbinde das hinterlegte Besitzerkonto erneut. Das einmalige Setup-Token wird dafür nicht benötigt. <button className="inline-button" type="button" onClick={() => void login()} disabled={!state.configured || rateLimited || busy === "login"}>{busy === "login" ? "Verbindung wird gestartet …" : "Spotify erneut verbinden"}</button></Notice>}
        {state.spotify?.expiringSoon && <Notice>Die Spotify-Verbindung läuft bald ab. Bitte verbinde das Konto vorsorglich neu.</Notice>}

        <StatisticsPanel
          statistics={statistics}
          range={statisticsRange}
          loading={statisticsLoading}
          error={statisticsError}
          onRangeChange={setStatisticsRange}
          onRefresh={() => void loadStatistics()}
        />

        {!state.party ? (
          <section className="admin-card create-party">
            <span className="section-kicker">Neuer Abend</span><h2>Party starten</h2>
            <form onSubmit={createParty}>
              <label><span>Partyname</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="z. B. Sommerfest" minLength={2} maxLength={80} required /></label>
              <fieldset><legend>Gast-Link</legend><label><input type="radio" name="origin" checked={origin === "public"} onChange={() => setOrigin("public")} /> Öffentlich · {state.publicBaseUrl}</label><label><input type="radio" name="origin" checked={origin === "lan"} onChange={() => setOrigin("lan")} /> Nur WLAN · {state.lanBaseUrl}</label></fieldset>
              {state.publicBaseUrl?.includes("127.0.0.1") && <Notice>Für Gäste auf dem iPhone bitte „Nur WLAN“ wählen. Die Adresse 127.0.0.1 funktioniert ausschließlich auf diesem Mac.</Notice>}
              <button className="primary-button" type="submit" disabled={busy === "create"}>{busy === "create" ? "Wird gestartet …" : "Party starten"}</button>
            </form>
          </section>
        ) : (
          <>
            <section className="admin-grid">
              <div className="admin-card party-code">
                <span className="section-kicker">Aktive Party</span><h2>{state.party.party.name}</h2>
                {state.qrDataUrl && <img src={state.qrDataUrl} alt={`QR-Code zum Gast-Link ${state.party.party.guestUrl}`} />}
                <a href={state.party.party.guestUrl} target="_blank" rel="noreferrer">{state.party.party.guestUrl}</a>
                <button className="secondary-button" type="button" onClick={() => void navigator.clipboard.writeText(state.party!.party.guestUrl).then(() => setMessage("Gast-Link kopiert."))}>Link kopieren</button>
                {state.qrDataUrl && <button className="secondary-button qr-export-trigger" type="button" onClick={() => setQrExportOpen(true)}>QR-Code drucken & exportieren</button>}
                <a className="display-wall-link" href={`${state.party.party.guestUrl}/display`} target="_blank" rel="noreferrer">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /><path d="m10 8 5 2.5-5 2.5V8Z" /></svg>
                  <span><strong>Display Wall öffnen</strong><small>Für Fernseher oder Monitor</small></span>
                  <i aria-hidden="true">↗</i>
                </a>
              </div>
              <div className="admin-card controls">
                <span className="section-kicker">Spotify Connect</span><h2>Wiedergabe</h2>
                <div className="admin-player" role="region" aria-label="Spotify Player">
                  <div className="admin-player__status">
                    <span>Jetzt läuft</span>
                    <span className={state.party.player.isPlaying ? "admin-player__live" : "admin-player__live admin-player__live--paused"}><i />{state.party.player.isPlaying ? "Spielt" : "Pausiert"}</span>
                  </div>
                  {currentTrack ? (
                    <div className="admin-player__body">
                      <Artwork track={currentTrack} size="hero" />
                      <div className="admin-player__details">
                        <TrackMeta track={currentTrack} />
                        <div className="progress" role="progressbar" aria-label="Fortschritt des laufenden Songs" aria-valuemin={0} aria-valuemax={currentTrack.durationMs} aria-valuenow={playerProgressMs}><span style={{ width: `${playerProgress}%` }} /></div>
                        <div className="progress-label"><span>{formatTime(playerProgressMs)}</span><span>−{formatTime(currentTrack.durationMs - playerProgressMs)}</span></div>
                        <div className="admin-player__device"><span aria-hidden="true">●</span>{state.party.player.deviceName ?? "Kein aktives Gerät"}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="admin-player__empty"><span aria-hidden="true">♫</span><div><strong>Noch keine Wiedergabe</strong><small>Starte einen Titel auf dem Spotify-Gerät.</small></div></div>
                  )}
                  <div className="admin-player__transport" aria-label="Wiedergabesteuerung">
                    <button
                      className="admin-player__play"
                      type="button"
                      aria-label={state.party.player.isPlaying ? "Wiedergabe pausieren" : "Wiedergabe fortsetzen"}
                      title={state.party.player.isPlaying ? "Pause" : "Wiedergabe fortsetzen"}
                      disabled={spotifyUnavailable || busy === "player-toggle"}
                      onClick={() => void togglePlayback()}
                    >
                      {state.party.player.isPlaying ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6V6Z" /></svg>
                      )}
                    </button>
                    <button
                      className="admin-player__skip"
                      type="button"
                      aria-label="Nächsten Titel abspielen"
                      title="Nächster Titel"
                      disabled={spotifyUnavailable || busy === "next"}
                      onClick={() => void action("next", "/api/admin/player/next")}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 6 8 6-8 6V6Z" /><path d="M17 6v12" /></svg>
                    </button>
                  </div>
                </div>
                <div className="admin-device-row">
                  <label><span>Zielgerät</span><select value={state.selectedDeviceId ?? ""} disabled={spotifyUnavailable} onChange={(event) => void action("device", "/api/admin/parties/active/device", "PUT", { deviceId: event.target.value }, "Zielgerät geändert.")}><option value="">Aktives Spotify-Gerät</option>{state.devices?.map((device) => <option key={device.id} value={device.id} disabled={device.isRestricted}>{device.name} · {device.type}{device.isRestricted ? " (gesperrt)" : ""}</option>)}</select></label>
                  <button className="device-refresh" type="button" aria-label="Geräteliste aktualisieren" title="Geräteliste aktualisieren" disabled={spotifyUnavailable || busy === "refresh-devices"} onClick={() => void refreshDevices()}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8.5A7 7 0 0 1 18.4 7L20 12M4 12l1.6 5A7 7 0 0 0 17.9 15.5" /></svg>
                  </button>
                </div>
                {state.party.player.warning && !spotifyUnavailable && <Notice>{state.party.player.warning}</Notice>}
                <button className="danger-button" type="button" onClick={() => window.confirm("Party wirklich beenden? Die Queue wird geschlossen.") && void action("end", "/api/admin/parties/active", "DELETE", undefined, "Party beendet.")} disabled={busy === "end"}>Party beenden</button>
              </div>
            </section>

            <section className="admin-card admin-queue">
              <div className="section-title-row"><div><span className="section-kicker">Moderation</span><h2>Offene Party Queue</h2></div><span>{state.party.queue.length} {state.party.queue.length === 1 ? "Song" : "Songs"}</span></div>
              {state.party.lockedNext && <Notice><strong>Fest eingeplant:</strong> {state.party.lockedNext.name}. Dieser Song wurde bereits an Spotify übergeben und kann nicht entfernt werden.</Notice>}
              {state.party.queue.length ? <ol className="queue-list">{state.party.queue.map((item, index) => <QueueRow key={item.queueId} item={item} position={index + 1} onRemove={() => void action(item.queueId, `/api/admin/queue/${item.queueId}`, "DELETE", undefined, `${item.name} wurde entfernt.`)} busy={busy === item.queueId} />)}</ol> : <EmptyState title="Keine offenen Wünsche">Neue Wünsche der Gäste erscheinen automatisch hier.</EmptyState>}
            </section>
          </>
        )}
      </main>
      {state.party && state.qrDataUrl && (
        <QrExportDialog
          open={qrExportOpen}
          partyName={state.party.party.name}
          guestUrl={state.party.party.guestUrl}
          qrDataUrl={state.qrDataUrl}
          onClose={() => setQrExportOpen(false)}
        />
      )}
    </div>
  );
}
