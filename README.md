# CrowdQueue

CrowdQueue ist eine mobile, selbst gehostete Party Queue für Spotify Connect. Gäste öffnen einen QR-Link ohne Anmeldung, suchen Spotify-Songs, stellen Musikwünsche und stimmen die Reihenfolge ab. Die Musik spielt weiterhin ausschließlich in der Spotify-App beziehungsweise auf dem gewählten Spotify-Connect-Gerät.

## Voraussetzungen

- Docker mit Compose
- Spotify Premium für das Host-Konto
- eine Spotify-Web-API-Anwendung im [Developer Dashboard](https://developer.spotify.com/dashboard)
- optional Caddy für HTTPS und öffentliche Erreichbarkeit

## Schnellstart

1. `.env.example` nach `.env` kopieren.
2. `PUBLIC_BASE_URL`, `LAN_BASE_URL` und die Secrets einschließlich `HEALTHCHECK_TOKEN` setzen. Secrets können jeweils mit `openssl rand -base64 48` erzeugt werden. Anschließend die Datei mit `chmod 600 .env` nur für den Betreiber lesbar machen.
3. Im Spotify Developer Dashboard als Redirect URI exakt den Wert aus `SPOTIFY_REDIRECT_URI` eintragen. Spotify verlangt HTTPS; nur `http://127.0.0.1:<port>` ist für lokale Entwicklung erlaubt.
4. Starten: `docker compose up -d --build`
5. `/admin` öffnen, das `ADMIN_SETUP_TOKEN` eingeben und Spotify verbinden.

> **Hinweis für Updates:** Ab dieser gehärteten Version ist `HEALTHCHECK_TOKEN` in Produktion verpflichtend. Vor dem Aktualisieren des Containers einmalig mit `openssl rand -base64 48` erzeugen und in die verwendete `.env` eintragen. Andernfalls verweigert der Server absichtlich den Start.

Der erste erfolgreich verbundene Spotify-Account wird dauerhaft als Besitzer festgelegt. Für einen bewussten Besitzerwechsel muss der Betreiber den Datenträger löschen oder den Eintrag `owner_account_id` direkt in der SQLite-Datenbank zurücksetzen.

Im Adminbereich lässt sich der aktive Gast-QR-Code zusätzlich exportieren. Verfügbar sind ein gestaltetes A4-Plakat, Kartenbögen mit 2, 4, 6, 8, 9 oder 12 Exemplaren und Schnittlinien sowie jeweils eine Farb- und eine tonerarme Schwarzweiß-Version. Der reine QR-Code kann außerdem hochauflösend als PNG geladen werden. Sämtliche Dateien entstehen lokal im Browser.

Die Admin-Konsole enthält außerdem eine API-Statistik für eine Stunde, 24 Stunden, sieben Tage oder 30 Tage. Sie zeigt eingehende CrowdQueue-Aufrufe nach Quelle und Endpoint sowie ausschließlich tatsächlich an Spotify gesendete Netzwerkaufrufe nach Auslöser, Endpoint, Fehlern, 429-Antworten und durchschnittlicher Antwortzeit. Cache-Treffer werden nicht als Spotify-Aufruf gezählt. Die Erfassung speichert nur minutenweise Summen; IP-Adressen, Party-Codes, Suchbegriffe, Song- und Geräte-IDs werden nicht übernommen.

## Caddy

[`Caddyfile.example`](./Caddyfile.example) enthält Beispiele für eine öffentliche Domain und einen nur im WLAN auflösbaren Hostnamen. Hinter Caddy wird `TRUST_PROXY` auf die exakte Proxy-IP oder ein enges privates Proxy-Netz gesetzt. `true` wird aus Sicherheitsgründen nur als Vertrauen in lokale/private Netze interpretiert. Stelle den App-Port im öffentlichen Betrieb nicht zusätzlich am Router frei, sondern leite ausschließlich über Caddy weiter.

Bei vorgeschaltetem Cloudflare müssen zusätzlich „Always Use HTTPS“, HSTS und als minimale TLS-Version mindestens TLS 1.2 aktiviert sein. Der Origin-Port darf nur für Caddy beziehungsweise den Tunnel erreichbar sein.
Optional kann eine Cloudflare-WAF-Regel öffentliche Anfragen auf den Pfad `/healthz` vollständig blockieren. Die interne Docker-Prüfung über `127.0.0.1` bleibt davon unberührt; bereits ohne diese Regel antwortet die Anwendung extern ohne korrekten Token nur mit 404.

Eine Party wird beim Erstellen entweder an die öffentliche oder die WLAN-Basis-URL gebunden. Der erzeugte QR-Code verwendet genau diese Adresse.

## Entwicklung

```sh
npm install
DEMO_MODE=true npm run dev
npm run dev:client
```

Frontend: `http://127.0.0.1:5173`, API: `http://127.0.0.1:8080`. Im Demo-Modus ist keine Spotify-Konfiguration nötig; der Admin-Login führt unmittelbar in die Oberfläche.
`DEMO_MODE=true` wird bei `NODE_ENV=production` absichtlich abgewiesen, damit der Demo-Admin-Header niemals in einer öffentlichen Installation aktiv werden kann.

## Betrieb

- Die SQLite-Datenbank liegt im Volume unter `/data/crowdqueue.sqlite` und verwendet WAL.
- Der Container läuft ohne Root-Rechte, mit schreibgeschütztem Root-Dateisystem und schreibt nur nach `/data`.
- `/healthz` prüft Server und Datenbank, akzeptiert aber ausschließlich `Authorization: Bearer $HEALTHCHECK_TOKEN`. Der Docker-Healthcheck sendet diesen Header intern; öffentliche Aufrufe erhalten 404.
- Beendete Partys und nicht mehr benötigte Spotify-Metadaten werden nach sieben Tagen entfernt.
- Aggregierte API-Statistiken bleiben maximal 30 Tage erhalten und werden in derselben SQLite-Datenbank gespeichert.
- Spotify Refresh-Tokens werden verschlüsselt gespeichert. Die Schlüssel gehören ausschließlich in `.env`, nie in das Image oder Repository. Eine Rotation des Refresh-Tokens verlängert dessen ursprüngliche Sechsmonatsfrist nicht; bei `invalid_grant` bleibt der festgelegte Besitzer erhalten und kann Spotify ohne Setup-Token erneut verbinden.
- Sichere regelmäßig das Docker-Volume. Ohne `ENCRYPTION_KEY` kann eine Sicherung der Spotify-Verbindung nicht wiederhergestellt werden.

## Grenzen von Spotify

Spotify erlaubt das Lesen und Anhängen an die native Playback Queue, aber kein freies Entfernen oder Umsortieren. Deshalb verwaltet CrowdQueue eine eigene votierbare Queue und übergibt etwa 30 Sekunden vor Songende genau einen Gewinner an Spotify. Der danach gesperrte Titel kann technisch nicht mehr zurückgeholt werden.

CrowdQueue verwendet adaptives Polling: Ohne offene Wünsche wird ein laufender Player höchstens alle zwei Minuten geprüft. Bei Pause oder fehlendem Gerät gilt ein Minutenabstand. Sobald Wünsche vorhanden sind, berechnet der Controller den nächsten Abruf aus der verbleibenden Songdauer und wacht gezielt für das 30-Sekunden-Lockfenster auf. Admin-Befehle und neue Wünsche lösen einen zusammengefassten Kontrollabruf aus. Die native Spotify-Queue wird regulär nur alle fünf Minuten sowie bei einem bereits gesperrten Folgetitel abgeglichen. Der Fortschrittsbalken läuft währenddessen lokal im Browser weiter und benötigt keine Spotify-Anfragen.

Geräte werden fünf Minuten, Suchergebnisse und die native Queue ebenfalls kurzzeitig zwischengespeichert. Eine sofortige Aktualisierung der Geräteliste ist im Adminbereich bewusst nur noch per Knopfdruck möglich. Nicht gecachte Gastzugriffe teilen sich zusätzlich ein serverweites Minutenbudget (`GUEST_SPOTIFY_REQUESTS_PER_MINUTE`, Standard 20). Spotify-Aufrufe von Admin und Controller werden vor wartenden Gastsuchen ausgeführt. Antwortet Spotify dennoch mit `429 Too Many Requests`, wird `Retry-After` zentral und dauerhaft in SQLite gespeichert. Fehlt ein gültiger Header, greift ein persistentes exponentielles Backoff. Bis zum Ablauf sendet der Server keine weiteren Spotify-Anfragen; die Oberfläche zeigt die verbleibende Wartezeit an. Bereits vorhandene Musikwünsche und Votes bleiben in dieser Zeit verfügbar.

Die Anwendung ist für private, nicht kommerzielle Feiern gedacht. Spotify Premium und die Spotify Developer Policy sind einzuhalten.
