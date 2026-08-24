import assert from "node:assert/strict";
import test from "node:test";
import { localeFor, translate, translateServerMessage } from "../client/src/locales";

test("deutsche Ausgangstexte und englische Übersetzungen verwenden denselben Katalog", () => {
  assert.equal(translate("de", "Party starten"), "Party starten");
  assert.equal(translate("en", "Party starten"), "Start party");
  assert.equal(translate("en", "{count} Wünsche frei", { count: 2 }), "2 requests remaining");
  assert.equal(localeFor("de"), "de-DE");
  assert.equal(localeFor("en"), "en-GB");
});

test("deutsche API-Meldungen werden für die englische Oberfläche übersetzt", () => {
  assert.equal(translateServerMessage("en", "Diese Party wurde nicht gefunden."), "This party was not found.");
  assert.equal(translateServerMessage("en", "Spotify-Fehler (503)."), "Spotify error (503).");
  assert.equal(
    translateServerMessage("en", "Spotify begrenzt momentan die Anfragen. CrowdQueue wartet automatisch bis zum von Spotify genannten Zeitpunkt. Verbleibende Wartezeit: ca. 2 Min."),
    "Spotify is currently limiting requests. CrowdQueue will automatically wait until the time specified by Spotify. Remaining wait: about 2 min",
  );
});
