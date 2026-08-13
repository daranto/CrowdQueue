import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "./api";
import { Brand, EmptyState, Loading, Notice, QueueRow, SearchResult, SpotifyLimitNotice } from "./components";
import { QrExportDialog } from "./QrExportDialog";
import type { AdminState, Track } from "./types";
import { useSearch } from "./useSearch";

export function AdminApp() {
  const [state, setState] = useState<AdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState<"public" | "lan">("lan");
  const [setupToken, setSetupToken] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | number | null>(null);
  const [qrExportOpen, setQrExportOpen] = useState(false);
  const rateLimited = state?.spotifyRateLimit?.limited ?? false;
  const spotifyConnected = state?.spotify?.connected ?? state?.connected ?? false;
  const spotifyUnavailable = rateLimited || !spotifyConnected;
  const search = useSearch("/api/admin/search", state?.authenticated && !spotifyUnavailable ? query : "");
  const demoMode = state?.demoMode ?? false;
  const oauthError = new URLSearchParams(window.location.search).get("error");
  const oauthErrorMessage = oauthError === "falsches_konto"
    ? "Dieses Spotify-Konto ist nicht als Besitzer hinterlegt. Bitte melde dich mit dem ursprünglichen Admin-Konto an."
    : oauthError === "spotify_abgebrochen"
      ? "Die Spotify-Anmeldung wurde abgebrochen."
      : null;

  const load = useCallback(async () => {
    try {
      setState(await api<AdminState>("/api/admin/state", demoMode ? { headers: { "x-demo-admin": "true" } } : undefined));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Adminbereich konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

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

  async function playNow(track: Track) {
    await action(track.id, "/api/admin/player/play-now", "POST", { trackId: track.id }, `${track.name} wird jetzt abgespielt.`);
    setQuery("");
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
              </div>
              <div className="admin-card controls">
                <span className="section-kicker">Spotify Connect</span><h2>Wiedergabe</h2>
                <label><span>Zielgerät</span><select value={state.selectedDeviceId ?? ""} disabled={spotifyUnavailable} onChange={(event) => void action("device", "/api/admin/parties/active/device", "PUT", { deviceId: event.target.value }, "Zielgerät geändert.")}><option value="">Aktives Spotify-Gerät</option>{state.devices?.map((device) => <option key={device.id} value={device.id} disabled={device.isRestricted}>{device.name} · {device.type}{device.isRestricted ? " (gesperrt)" : ""}</option>)}</select></label>
                <div className="control-buttons"><button type="button" disabled={spotifyUnavailable} onClick={() => void action("pause", "/api/admin/player/pause")}>Pause</button><button type="button" disabled={spotifyUnavailable} onClick={() => void action("resume", "/api/admin/player/resume")}>Weiter</button><button type="button" disabled={spotifyUnavailable} onClick={() => void action("next", "/api/admin/player/next")}>Nächster</button></div>
                {state.party.player.warning && !spotifyUnavailable && <Notice>{state.party.player.warning}</Notice>}
                <button className="danger-button" type="button" onClick={() => window.confirm("Party wirklich beenden? Die Queue wird geschlossen.") && void action("end", "/api/admin/parties/active", "DELETE", undefined, "Party beendet.")} disabled={busy === "end"}>Party beenden</button>
              </div>
            </section>

            <section className="admin-card admin-search">
              <span className="section-kicker">Direkte Wiedergabe</span><h2>Song sofort spielen</h2>
              <label className="search-field"><span className="sr-only">Song oder Künstler suchen</span><span aria-hidden="true">⌕</span><input aria-label="Song oder Künstler suchen" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={!spotifyConnected ? "Spotify erneut verbinden" : rateLimited ? "Spotify-Suche pausiert" : "Song oder Künstler …"} disabled={spotifyUnavailable} /></label>
              {search.error && <Notice tone="error">{search.error}</Notice>}
              {search.loading && <Loading label="Spotify wird durchsucht …" />}
              {search.items.length > 0 && <ul className="search-results">{search.items.map((track) => <SearchResult key={track.id} track={track} actionLabel="Sofort abspielen" onAction={() => void playNow(track)} busy={busy === track.id} />)}</ul>}
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
