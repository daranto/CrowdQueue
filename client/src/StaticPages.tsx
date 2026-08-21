import { Brand } from "./components";

export function HomePage() {
  return <div className="home-page"><header className="topbar"><Brand /></header><main id="main" className="home-hero"><div className="home-hero__copy"><span className="section-kicker">Deiner Party beitreten</span><h1>Scanne den<br />Party-QR-Code.</h1><p>Bitte scanne den QR-Code des Gastgebers oder öffne den geteilten Party-Link. So gelangst du direkt zur Musiksuche und zur gemeinsamen Warteschlange.</p><span className="home-hint">Keine App. Kein Login. Direkt mitbestimmen.</span></div><div className="home-visual" aria-hidden="true"><div className="home-vinyl"><span className="brand__mark"><i /><i /><i /></span></div><i className="scan-corner scan-corner--a" /><i className="scan-corner scan-corner--b" /><span>Scan &amp; play</span></div></main><footer className="footer"><Brand compact /><p>Für private, nicht kommerzielle Feiern.</p><a href="/datenschutz">Datenschutz</a></footer></div>;
}

export function PrivacyPage() {
  return (
    <div className="static-page">
      <header className="topbar"><Brand /><a className="text-link" href="/">Startseite</a></header>
      <main id="main" className="privacy-main">
        <header className="privacy-hero">
          <div>
            <span className="section-kicker">Transparenz</span>
            <h1>Datenschutz<span>.</span></h1>
          </div>
          <p>Diese selbst gehostete Anwendung verarbeitet nur die Daten, die für die Party Queue erforderlich sind.</p>
          <div className="privacy-summary" aria-label="Datenschutz auf einen Blick">
            <span><strong>Ohne</strong> Gast-Login</span>
            <span><strong>7 Tage</strong> Party-Daten</span>
            <span><strong>Lokal</strong> betrieben</span>
          </div>
        </header>

        <div className="privacy-layout">
          <nav className="privacy-nav" aria-label="Inhalt der Datenschutzerklärung">
            <span>Was passiert wo?</span>
            <a href="#geraetekennung">Auf deinem Gerät</a>
            <a href="#ip-adressen">Auf dem Server</a>
            <a href="#spotify-daten">Von Spotify</a>
            <a href="#admin-verbindung">Nur beim Host</a>
            <a href="#loeschen">Automatisch gelöscht</a>
          </nav>

          <article className="privacy-content">
            <section id="geraetekennung">
              <div className="privacy-section-heading"><span>Auf deinem Gerät</span><h2>Gerätekennung und Abstimmungen</h2></div>
              <p>Beim ersten Besuch wird eine zufällige, signierte Kennung als HttpOnly-Cookie auf deinem Gerät gespeichert. Sie verhindert doppelte Stimmen und begrenzt offene Wünsche. Wenn du Browserdaten löschst, entsteht eine neue Kennung.</p>
            </section>
            <section id="ip-adressen">
              <div className="privacy-section-heading"><span>Auf dem Server</span><h2>IP-Adressen</h2></div>
              <p>IP-Adressen werden nicht im Klartext gespeichert. Zur Missbrauchsbegrenzung wird ein nur für den jeweiligen Tag gültiger kryptografischer Prüfwert gebildet.</p>
            </section>
            <section id="spotify-daten">
              <div className="privacy-section-heading"><span>Von Spotify</span><h2>Spotify-Daten</h2></div>
              <p>Songtitel, Künstler, Album, Links und Cover-URLs stammen von Spotify. Cover werden nicht heruntergeladen oder lokal kopiert. Spotify-Metadaten werden spätestens sieben Tage nach Ende einer Party gelöscht.</p>
            </section>
            <section id="admin-verbindung">
              <div className="privacy-section-heading"><span>Nur beim Host</span><h2>Admin-Verbindung</h2></div>
              <p>Der Spotify-Zugriff des Administrators wird verschlüsselt in der lokalen Datenbank des selbst betriebenen Servers gespeichert. Gäste erhalten diese Zugangsdaten niemals.</p>
            </section>
            <section id="loeschen">
              <div className="privacy-section-heading"><span>Automatisch</span><h2>Löschen</h2></div>
              <p>Der Administrator kann eine Party beenden. Die zugehörigen Daten werden automatisch nach sieben Tagen gelöscht. Die Gerätekennung kann jederzeit über die Browserdaten entfernt werden.</p>
            </section>
            <footer className="privacy-responsibility">
              <span aria-hidden="true">i</span>
              <p>Verantwortlich für den Betrieb und die konkrete Datenschutzerklärung ist die Person, die diesen Server bereitstellt.</p>
            </footer>
          </article>
        </div>
      </main>
      <footer className="footer"><Brand compact /><p>Für private, nicht kommerzielle Feiern.</p><a href="/">Zur Startseite</a></footer>
    </div>
  );
}

export function NotFoundPage() {
  return <div className="static-page"><header className="topbar"><Brand /></header><main id="main" className="auth-card"><span className="section-kicker">404</span><h1>Hier spielt nichts.</h1><p>Der Link ist ungültig oder nicht mehr verfügbar.</p><a className="primary-button" href="/">Zur Startseite</a></main></div>;
}
