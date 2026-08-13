import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSpotifyRedirectUri } from "../server/config.js";

describe("Spotify Redirect URI", () => {
  it("akzeptiert HTTPS und die expliziten Loopback-Ausnahmen", () => {
    assert.equal(
      validateSpotifyRedirectUri("https://crowdqueue.gönn.eu/api/admin/spotify/callback"),
      "https://crowdqueue.gönn.eu/api/admin/spotify/callback",
    );
    assert.equal(
      validateSpotifyRedirectUri("http://127.0.0.1:8080/api/admin/spotify/callback"),
      "http://127.0.0.1:8080/api/admin/spotify/callback",
    );
    assert.equal(
      validateSpotifyRedirectUri("http://[::1]:8080/api/admin/spotify/callback"),
      "http://[::1]:8080/api/admin/spotify/callback",
    );
  });

  it("weist unsichere oder von Spotify nicht erlaubte Adressen zurück", () => {
    assert.throws(() => validateSpotifyRedirectUri("http://party.example/callback"), /HTTPS/);
    assert.throws(() => validateSpotifyRedirectUri("http://localhost:8080/callback"), /localhost/);
    assert.throws(() => validateSpotifyRedirectUri("https://*.example.com/callback"), /Wildcards/);
    assert.throws(() => validateSpotifyRedirectUri("https://user:secret@example.com/callback"), /Zugangsdaten/);
    assert.throws(() => validateSpotifyRedirectUri("keine-url"), /gültige absolute URL/);
  });
});
