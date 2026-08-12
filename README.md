# CrowdQueue

CrowdQueue ist eine mobile, selbst gehostete Party Queue für Spotify Connect. Gäste öffnen einen QR-Link ohne Anmeldung, suchen Spotify-Songs, stellen Musikwünsche und stimmen die Reihenfolge ab. Die Musik spielt weiterhin ausschließlich in der Spotify-App beziehungsweise auf dem gewählten Spotify-Connect-Gerät.

## Voraussetzungen

- Docker mit Compose
- Spotify Premium für das Host-Konto
- eine Spotify-Web-API-Anwendung im [Developer Dashboard](https://developer.spotify.com/dashboard)
- optional Caddy für HTTPS und öffentliche Erreichbarkeit

## Schnellstart

1. `.env.example` nach `.env` kopieren.
2. `PUBLIC_BASE_URL`, `LAN_BASE_URL` und die drei Secrets setzen. Secrets können jeweils mit `openssl rand -base64 48` erzeugt werden. Anschließend die Datei mit `chmod 600 .env` nur für den Betreiber lesbar machen.
3. Im Spotify Developer Dashboard als Redirect URI exakt den Wert aus `SPOTIFY_REDIRECT_URI` eintragen. Spotify verlangt HTTPS; nur `http://127.0.0.1:<port>` ist für lokale Entwicklung erlaubt.
4. Starten: `docker compose up -d --build`
5. `/admin` öffnen, das `ADMIN_SETUP_TOKEN` eingeben und Spotify verbinden.

Der erste erfolgreich verbundene Spotify-Account wird dauerhaft als Besitzer festgelegt. Für einen bewussten Besitzerwechsel muss der Betreiber den Datenträger löschen oder den Eintrag `owner_account_id` direkt in der SQLite-Datenbank zurücksetzen.

## Caddy

[`Caddyfile.example`](./Caddyfile.example) enthält Beispiele für eine öffentliche Domain und einen nur im WLAN auflösbaren Hostnamen. Hinter Caddy wird `TRUST_PROXY` auf die exakte Proxy-IP oder ein enges privates Proxy-Netz gesetzt. `true` wird aus Sicherheitsgründen nur als Vertrauen in lokale/private Netze interpretiert. Stelle den App-Port im öffentlichen Betrieb nicht zusätzlich am Router frei, sondern leite ausschließlich über Caddy weiter.

Bei vorgeschaltetem Cloudflare müssen zusätzlich „Always Use HTTPS“, HSTS und als minimale TLS-Version mindestens TLS 1.2 aktiviert sein. Der Origin-Port darf nur für Caddy beziehungsweise den Tunnel erreichbar sein.

Eine Party wird beim Erstellen entweder an die öffentliche oder die WLAN-Basis-URL gebunden. Der erzeugte QR-Code verwendet genau diese Adresse.

## Entwicklung

```sh
npm install
DEMO_MODE=true npm run dev
npm run dev:client
```

Frontend: `http://127.0.0.1:5173`, API: `http://127.0.0.1:8080`. Im Demo-Modus ist keine Spotify-Konfiguration nötig; der Admin-Login führt unmittelbar in die Oberfläche.

## Betrieb

- Die SQLite-Datenbank liegt im Volume unter `/data/crowdqueue.sqlite` und verwendet WAL.
- Der Container läuft ohne Root-Rechte, mit schreibgeschütztem Root-Dateisystem und schreibt nur nach `/data`.
- `/healthz` prüft Server und Datenbank.
- Beendete Partys und nicht mehr benötigte Spotify-Metadaten werden nach sieben Tagen entfernt.
- Spotify Refresh-Tokens werden verschlüsselt gespeichert. Die Schlüssel gehören ausschließlich in `.env`, nie in das Image oder Repository.
- Sichere regelmäßig das Docker-Volume. Ohne `ENCRYPTION_KEY` kann eine Sicherung der Spotify-Verbindung nicht wiederhergestellt werden.

## Grenzen von Spotify

Spotify erlaubt das Lesen und Anhängen an die native Playback Queue, aber kein freies Entfernen oder Umsortieren. Deshalb verwaltet CrowdQueue eine eigene votierbare Queue und übergibt etwa 30 Sekunden vor Songende genau einen Gewinner an Spotify. Der danach gesperrte Titel kann technisch nicht mehr zurückgeholt werden.

Die Anwendung ist für private, nicht kommerzielle Feiern gedacht. Spotify Premium und die Spotify Developer Policy sind einzuhalten.
