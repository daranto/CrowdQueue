import { Brand, LanguageSwitcher } from "./components";
import { useI18n } from "./i18n";

export function HomePage() {
  const { t } = useI18n();
  return <div className="home-page"><header className="topbar"><Brand /><LanguageSwitcher /></header><main id="main" className="home-hero"><div className="home-hero__copy"><span className="section-kicker">{t("Deiner Party beitreten")}</span><h1>{t("Scanne den")}<br />{t("Party-QR-Code.")}</h1><p>{t("Bitte scanne den QR-Code des Gastgebers oder öffne den geteilten Party-Link. So gelangst du direkt zur Musiksuche und zur gemeinsamen Warteschlange.")}</p><span className="home-hint">{t("Keine App. Kein Login. Direkt mitbestimmen.")}</span></div><div className="home-visual" aria-hidden="true"><div className="home-vinyl"><span className="brand__mark"><i /><i /><i /></span></div><i className="scan-corner scan-corner--a" /><i className="scan-corner scan-corner--b" /><span>Scan &amp; play</span></div></main><footer className="footer"><Brand compact /><p>{t("Für private, nicht kommerzielle Feiern.")}</p><a href="/datenschutz">{t("Datenschutz")}</a></footer></div>;
}

export function PrivacyPage() {
  const { t } = useI18n();
  return (
    <div className="static-page">
      <header className="topbar"><Brand /><div className="topbar__actions"><LanguageSwitcher /><a className="text-link" href="/">{t("Startseite")}</a></div></header>
      <main id="main" className="privacy-main">
        <header className="privacy-hero">
          <div>
            <span className="section-kicker">{t("Transparenz")}</span>
            <h1>{t("Datenschutz")}<span>.</span></h1>
          </div>
          <p>{t("Diese selbst gehostete Anwendung verarbeitet nur die Daten, die für die Party Queue erforderlich sind.")}</p>
          <div className="privacy-summary" aria-label={t("Datenschutz auf einen Blick")}>
            <span><strong>{t("Ohne")}</strong> {t("Gast-Login")}</span>
            <span><strong>{t("7 Tage")}</strong> {t("Party-Daten")}</span>
            <span><strong>{t("Lokal")}</strong> {t("betrieben")}</span>
          </div>
        </header>

        <div className="privacy-layout">
          <nav className="privacy-nav" aria-label={t("Inhalt der Datenschutzerklärung")}>
            <span>{t("Was passiert wo?")}</span>
            <a href="#geraetekennung">{t("Auf deinem Gerät")}</a>
            <a href="#ip-adressen">{t("Auf dem Server")}</a>
            <a href="#spotify-daten">{t("Von Spotify")}</a>
            <a href="#admin-verbindung">{t("Nur beim Host")}</a>
            <a href="#loeschen">{t("Automatisch gelöscht")}</a>
          </nav>

          <article className="privacy-content">
            <section id="geraetekennung">
              <div className="privacy-section-heading"><span>{t("Auf deinem Gerät")}</span><h2>{t("Gerätekennung und Abstimmungen")}</h2></div>
              <p>{t("Beim ersten Besuch wird eine zufällige, signierte Kennung als HttpOnly-Cookie auf deinem Gerät gespeichert. Sie verhindert doppelte Stimmen und begrenzt offene Wünsche. Wenn du Browserdaten löschst, entsteht eine neue Kennung.")}</p>
            </section>
            <section id="ip-adressen">
              <div className="privacy-section-heading"><span>{t("Auf dem Server")}</span><h2>{t("IP-Adressen")}</h2></div>
              <p>{t("IP-Adressen werden nicht im Klartext gespeichert. Zur Missbrauchsbegrenzung wird ein nur für den jeweiligen Tag gültiger kryptografischer Prüfwert gebildet.")}</p>
            </section>
            <section id="spotify-daten">
              <div className="privacy-section-heading"><span>{t("Von Spotify")}</span><h2>{t("Spotify-Daten")}</h2></div>
              <p>{t("Songtitel, Künstler, Album, Links und Cover-URLs stammen von Spotify. Cover werden nicht heruntergeladen oder lokal kopiert. Spotify-Metadaten werden spätestens sieben Tage nach Ende einer Party gelöscht.")}</p>
            </section>
            <section id="admin-verbindung">
              <div className="privacy-section-heading"><span>{t("Nur beim Host")}</span><h2>{t("Admin-Verbindung")}</h2></div>
              <p>{t("Der Spotify-Zugriff des Administrators wird verschlüsselt in der lokalen Datenbank des selbst betriebenen Servers gespeichert. Gäste erhalten diese Zugangsdaten niemals.")}</p>
            </section>
            <section id="loeschen">
              <div className="privacy-section-heading"><span>{t("Automatisch")}</span><h2>{t("Löschen")}</h2></div>
              <p>{t("Der Administrator kann eine Party beenden. Die zugehörigen Daten werden automatisch nach sieben Tagen gelöscht. Die Gerätekennung kann jederzeit über die Browserdaten entfernt werden.")}</p>
            </section>
            <footer className="privacy-responsibility">
              <span aria-hidden="true">i</span>
              <p>{t("Verantwortlich für den Betrieb und die konkrete Datenschutzerklärung ist die Person, die diesen Server bereitstellt.")}</p>
            </footer>
          </article>
        </div>
      </main>
      <footer className="footer"><Brand compact /><p>{t("Für private, nicht kommerzielle Feiern.")}</p><a href="/">{t("Zur Startseite")}</a></footer>
    </div>
  );
}

export function NotFoundPage() {
  const { t } = useI18n();
  return <div className="static-page"><header className="topbar"><Brand /><LanguageSwitcher /></header><main id="main" className="auth-card"><span className="section-kicker">404</span><h1>{t("Hier spielt nichts.")}</h1><p>{t("Der Link ist ungültig oder nicht mehr verfügbar.")}</p><a className="primary-button" href="/">{t("Zur Startseite")}</a></main></div>;
}
