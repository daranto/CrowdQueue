import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, request }) => {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem("crowdqueue-language")) window.localStorage.setItem("crowdqueue-language", "de");
  });
  const state = await request.get("/api/admin/state", { headers: { "x-demo-admin": "true" } });
  const admin = await state.json();
  if (admin.party) {
    await request.delete("/api/admin/parties/active", { headers: { "x-demo-admin": "true", "x-csrf-token": "demo-csrf" } });
  }
  const created = await request.post("/api/admin/parties", {
    headers: { "x-demo-admin": "true", "x-csrf-token": "demo-csrf" },
    data: { name: "Mobile Testparty", origin: "public" },
  });
  expect(created.ok()).toBeTruthy();
});

test("Sprache kann auf Englisch umgestellt und gespeichert werden", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Sprache" }).selectOption("en");
  await expect(page.getByRole("heading", { name: /Scan the party QR code/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Language" })).toHaveValue("en");
});

test("Direkter Aufruf begrüßt Gäste nur mit dem QR-Code-Hinweis", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Scanne den Party-QR-Code/ })).toBeVisible();
  await expect(page.getByText(/QR-Code des Gastgebers/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Admin|Party einrichten/ })).toHaveCount(0);
});

test("Logo bleibt beim Wechsel zur Datenschutzseite an derselben Position", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const homeLogoX = await page.locator(".topbar .brand").evaluate((element) => element.getBoundingClientRect().x);
  await page.getByRole("link", { name: "Datenschutz" }).click();
  await expect(page).toHaveURL(/\/datenschutz$/);
  const privacyLogoX = await page.locator(".topbar .brand").evaluate((element) => element.getBoundingClientRect().x);
  const scrollbarGutter = await page.locator("html").evaluate((element) => getComputedStyle(element).scrollbarGutter);

  expect(scrollbarGutter).toContain("stable");
  expect(privacyLogoX).toBeCloseTo(homeLogoX, 1);
});

test("Leerer Wiedergabestatus nutzt mobil die gesamte Karte", async ({ page, request }) => {
  const response = await request.get("/api/admin/state", { headers: { "x-demo-admin": "true" } });
  const admin = await response.json();
  await page.route(`**/api/parties/${admin.party.party.code}/state`, async (route) => {
    const stateResponse = await route.fetch();
    const partyState = await stateResponse.json();
    await route.fulfill({ response: stateResponse, json: { ...partyState, nowPlaying: null } });
  });
  await page.goto(`/p/${admin.party.party.code}`);

  const emptyNowPlaying = page.locator(".now-playing > .empty");
  await expect(emptyNowPlaying.getByRole("heading", { name: "Noch spielt nichts" })).toBeVisible();
  const layout = await emptyNowPlaying.evaluate((element) => {
    const parentWidth = element.parentElement?.getBoundingClientRect().width ?? 0;
    return { width: element.getBoundingClientRect().width, parentWidth };
  });
  expect(layout.width).toBeGreaterThan(layout.parentWidth * 0.8);
});

test("Fest eingeplanter Track bleibt in derselben Player-Karte", async ({ page, request }) => {
  const response = await request.get("/api/admin/state", { headers: { "x-demo-admin": "true" } });
  const admin = await response.json();
  let includeLockedNext = true;
  await page.route(`**/api/parties/${admin.party.party.code}/state`, async (route) => {
    const stateResponse = await route.fetch();
    const partyState = await stateResponse.json();
    await route.fulfill({
      response: stateResponse,
      json: {
        ...partyState,
        lockedNext: includeLockedNext ? {
          id: "demo-2",
          uri: "spotify:track:demo-2",
          name: "Dance The Night",
          artists: "Dua Lipa",
          album: "Barbie The Album",
          imageUrl: null,
          spotifyUrl: "https://open.spotify.com",
          durationMs: 176000,
          explicit: false,
        } : null,
      },
    });
  });

  const refreshPartyState = async () => {
    const stateResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "GET" && candidate.url().includes(`/api/parties/${admin.party.party.code}/state`),
    );
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await stateResponse;
  };

  await page.addInitScript(() => {
    const animationNames: string[] = [];
    Object.defineProperty(window, "__crowdQueueAnimationNames", { value: animationNames });
    document.addEventListener("animationstart", (event) => animationNames.push(event.animationName));
  });
  const observedAnimations = () => page.evaluate(() =>
    (window as Window & { __crowdQueueAnimationNames: string[] }).__crowdQueueAnimationNames,
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${admin.party.party.code}`);

  const player = page.locator(".now-playing");
  const next = player.locator(".now-playing__next");
  await expect(next.getByText("Dance The Night")).toBeVisible();
  await expect(page.locator(".locked-card")).toHaveCount(0);

  const desktop = await page.evaluate(() => {
    const current = document.querySelector(".now-playing__content");
    const next = document.querySelector(".now-playing__next");
    const currentRect = current?.getBoundingClientRect();
    const nextRect = next?.getBoundingClientRect();
    return {
      currentX: currentRect?.x ?? 0,
      nextX: nextRect?.x ?? 0,
    };
  });
  expect(desktop.nextX).toBeGreaterThan(desktop.currentX);
  await expect.poll(observedAnimations).toContain("next-track-enter-inline");

  await expect(next).toHaveClass(/now-playing__next--visible/);
  includeLockedNext = false;
  await refreshPartyState();
  await expect(next).toHaveClass(/now-playing__next--exiting/);
  await expect.poll(observedAnimations).toContain("next-track-exit-inline");
  await expect(next).toHaveCount(0, { timeout: 1_200 });

  await page.setViewportSize({ width: 390, height: 844 });
  includeLockedNext = true;
  await refreshPartyState();
  await expect(next).toHaveClass(/now-playing__next--entering/);
  const mobile = await page.evaluate(() => {
    const current = document.querySelector(".now-playing__content");
    const next = document.querySelector(".now-playing__next");
    const currentRect = current?.getBoundingClientRect();
    const nextRect = next?.getBoundingClientRect();
    return {
      currentY: currentRect?.y ?? 0,
      nextY: nextRect?.y ?? 0,
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(mobile.nextY).toBeGreaterThan(mobile.currentY);
  await expect.poll(observedAnimations).toContain("next-track-enter-stacked");
  expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.viewportWidth);

  await expect(next).toHaveClass(/now-playing__next--visible/);
  includeLockedNext = false;
  await refreshPartyState();
  await expect(next).toHaveClass(/now-playing__next--exiting/);
  await expect.poll(observedAnimations).toContain("next-track-exit-stacked");
  await expect(next).toHaveCount(0, { timeout: 1_200 });
});

test("Aktueller Track blendet auf Wall, Gastseite und im Admin weich um", async ({ page, request }) => {
  const response = await request.get("/api/admin/state", { headers: { "x-demo-admin": "true" } });
  const admin = await response.json();
  const code = admin.party.party.code;
  const replacement = {
    ...admin.party.nowPlaying,
    id: "fade-transition-track",
    uri: "spotify:track:fade-transition-track",
    name: "Soft Transition",
    artists: "CrowdQueue",
    album: "Motion Studies",
  };
  let showReplacement = false;

  await page.route(`**/api/parties/${code}/state`, async (route) => {
    const stateResponse = await route.fetch();
    const partyState = await stateResponse.json();
    await route.fulfill({
      response: stateResponse,
      json: { ...partyState, nowPlaying: showReplacement ? replacement : partyState.nowPlaying },
    });
  });

  const refreshPublicState = async () => {
    const stateResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "GET" && candidate.url().includes(`/api/parties/${code}/state`),
    );
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await stateResponse;
  };

  await page.addInitScript(() => {
    const animationNames: string[] = [];
    Object.defineProperty(window, "__crowdQueueAnimationNames", { value: animationNames });
    document.addEventListener("animationstart", (event) => animationNames.push(event.animationName));
  });
  const observedAnimations = () => page.evaluate(() =>
    (window as Window & { __crowdQueueAnimationNames: string[] }).__crowdQueueAnimationNames,
  );
  const resetObservedAnimations = () => page.evaluate(() => {
    (window as Window & { __crowdQueueAnimationNames: string[] }).__crowdQueueAnimationNames.length = 0;
  });

  const expectFadeSwap = async (selector: string) => {
    const player = page.locator(selector);
    await expect(player).toHaveClass(/now-track-transition--visible/);
    await resetObservedAnimations();
    showReplacement = true;
    await refreshPublicState();
    await expect.poll(observedAnimations).toContain("now-track-fade-out");
    await expect(page.getByText("Soft Transition", { exact: true })).toBeVisible({ timeout: 1_200 });
    await expect.poll(observedAnimations).toContain("now-track-fade-in");
    await expect(page.locator(selector)).toHaveClass(/now-track-transition--visible/, { timeout: 1_200 });
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/p/${code}`);
  await expectFadeSwap(".now-playing__current");

  showReplacement = false;
  await page.goto(`/p/${code}/display`);
  await expectFadeSwap(".wall-now__layout");
  await expect.poll(observedAnimations).toContain("wall-record-slide-in");

  showReplacement = false;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/p/${code}/display`);
  const reducedMotionPlayer = page.locator(".wall-now__layout");
  await expect(reducedMotionPlayer).toHaveClass(/now-track-transition--visible/);
  await resetObservedAnimations();
  showReplacement = true;
  await refreshPublicState();
  await expect.poll(observedAnimations).toContain("now-track-fade-out");
  await expect(page.getByText("Soft Transition", { exact: true })).toBeVisible({ timeout: 1_200 });
  await expect.poll(observedAnimations).toContain("now-track-fade-in");
  await expect(reducedMotionPlayer).toHaveClass(/now-track-transition--visible/, { timeout: 1_200 });
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.unroute(`**/api/parties/${code}/state`);
  let showAdminReplacement = false;
  await page.route("**/api/admin/state*", async (route) => {
    await route.fulfill({
      json: showAdminReplacement
        ? { ...admin, party: { ...admin.party, nowPlaying: replacement } }
        : admin,
    });
  });
  await page.setExtraHTTPHeaders({ "x-demo-admin": "true" });
  await page.goto("/admin");
  const adminPlayer = page.locator(".admin-player__body");
  await expect(adminPlayer).toHaveClass(/now-track-transition--visible/);
  const previousTitle = await adminPlayer.locator(".track-meta__title").innerText();
  await resetObservedAnimations();
  showAdminReplacement = true;
  await page.getByRole("button", { name: "Nächsten Titel abspielen" }).click();
  await expect(adminPlayer).toHaveClass(/now-track-transition--exiting/);
  await expect.poll(observedAnimations).toContain("now-track-fade-out");
  await expect(adminPlayer.locator(".track-meta__title")).not.toHaveText(previousTitle, { timeout: 1_200 });
  await expect.poll(observedAnimations).toContain("now-track-fade-in");
  await expect(page.locator(".admin-player__body")).toHaveClass(/now-track-transition--visible/, { timeout: 1_200 });
});

test("Gast kann mobil suchen, wünschen und voten", async ({ page, request }) => {
  const response = await request.get("/api/admin/state", { headers: { "x-demo-admin": "true" } });
  const admin = await response.json();
  await page.goto(`/p/${admin.party.party.code}`);

  await expect(page.getByRole("heading", { name: "Mobile Testparty" })).toBeVisible();
  const spotifyQueueButton = page.getByRole("button", { name: /Spotify Warteschlange öffnen/ });
  await expect(spotifyQueueButton).toBeVisible();
  await expect(page.locator(".native-queue")).toHaveCount(0);
  await spotifyQueueButton.click();
  const spotifyQueueDialog = page.getByRole("dialog", { name: "Spotify Warteschlange" });
  await expect(spotifyQueueDialog).toBeVisible();
  await expect(spotifyQueueDialog.getByText("Dance The Night")).toBeVisible();
  await expect(spotifyQueueDialog.getByText("Blinding Lights")).toBeVisible();
  expect(await spotifyQueueDialog.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
  await page.keyboard.press("Escape");
  await expect(spotifyQueueDialog).toBeHidden();
  await expect(spotifyQueueButton).toBeFocused();
  await spotifyQueueButton.click();
  await spotifyQueueDialog.getByRole("button", { name: "Spotify Warteschlange schließen" }).click();
  await expect(spotifyQueueDialog).toBeHidden();

  const resumedStateRequest = page.waitForRequest((request) =>
    request.method() === "GET" && request.url().includes(`/api/parties/${admin.party.party.code}/state`),
  );
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await resumedStateRequest;
  await expect(page.getByRole("region", { name: "Song finden" })).toBeVisible();
  await expect(page.getByText("3 Wünsche frei")).toBeVisible();
  const searchbox = page.getByRole("searchbox", { name: "Song oder Künstler suchen" });
  await searchbox.fill("Dua");
  await searchbox.press("Enter");
  await expect(searchbox).not.toBeFocused();
  await expect(page.getByRole("button", { name: /Song wünschen: Dance The Night/ })).toBeVisible();
  await page.getByRole("button", { name: /Song wünschen: Dance The Night/ }).click();
  await expect(page.getByRole("region", { name: "Song finden" }).getByRole("status")).toContainText(/gewünscht|Stimme/);
  await expect(page.getByRole("searchbox", { name: "Song oder Künstler suchen" })).toHaveValue("Dua");
  await expect(page.getByText("2 Wünsche frei")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bereits gewünscht: Dance The Night" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Bereits gewünscht: Dance The Night" })).toContainText("Schon drin");
  await expect(page.getByRole("button", { name: /Song wünschen: Levitating/ })).toBeVisible();
  await expect(page.getByText(/Eigener Wunsch: Dance The Night/)).toBeAttached();
  await expect(page.getByRole("button", { name: /Dance The Night, aktuell/ })).toHaveCount(0);

  await request.post(`/api/parties/${admin.party.party.code}/requests`, { data: { trackId: "demo-3" } });
  const otherVote = page.getByRole("button", { name: /Für Song stimmen: Blinding Lights/ });
  await expect(otherVote).toBeVisible();
  await otherVote.click();
  await expect(page.getByRole("button", { name: /Stimme entfernen: Blinding Lights, aktuell 1 Stimme/ })).toBeVisible();

  const layout = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);

  const undersized = await page.locator("button, input, select, summary, a").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && !element.classList.contains("skip-link") && (rect.width < 44 || rect.height < 44)
        ? [{ tag: element.tagName, label: element.getAttribute("aria-label") ?? element.textContent?.trim(), width: rect.width, height: rect.height }]
        : [];
    }),
  );
  expect(undersized).toEqual([]);
});

test("Display Wall zeigt ausschließlich Musikwünsche und passt sich dem Bildschirm an", async ({ page, request }) => {
  const response = await request.get("/api/admin/state", { headers: { "x-demo-admin": "true" } });
  const admin = await response.json();
  const displayUrl = `/p/${admin.party.party.code}/display`;
  let showManyWishes = false;
  await page.route(`**/api/parties/${admin.party.party.code}/state`, async (route) => {
    const stateResponse = await route.fetch();
    if (!showManyWishes) {
      await route.fulfill({ response: stateResponse });
      return;
    }
    const partyState = await stateResponse.json();
    const template = partyState.nativeQueue[0];
    const queueItem = (id: string, name: string, queueId: number, score: number) => ({
      ...template,
      id,
      uri: `spotify:track:${id}`,
      name,
      queueId,
      status: "pending",
      score,
      requestedAt: new Date(queueId * 1000).toISOString(),
      requestedByMe: false,
      votedByMe: false,
      error: null,
    });
    await route.fulfill({
      response: stateResponse,
      json: {
        ...partyState,
        lockedNext: { ...queueItem("wall-wish-1", "Dance The Night", 901, 4), status: "locked" },
        queue: [
          queueItem("wall-wish-2", "Wunsch Nummer Zwei", 902, 3),
          queueItem("wall-wish-3", "Wunsch Nummer Drei", 903, 2),
          queueItem("wall-wish-4", "Wunsch Nummer Vier", 904, 1),
          queueItem("wall-wish-5", "Wunsch Nummer Fünf", 905, 0),
        ],
      },
    });
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(displayUrl);

  await expect(page.getByText("Midnight City", { exact: true })).toBeVisible();
  await expect(page.locator(".display-wall__party strong")).toHaveText(admin.party.party.name);
  await expect(page.locator(".display-wall__connection")).toHaveCount(0);
  await expect(page.locator(".wall-now__copy > p")).toHaveText("M83");
  await expect(page.locator(".wall-now__copy > p")).not.toContainText("Hurry Up, We're Dreaming");
  await expect(page.locator(".wall-now").getByText("Läuft gerade", { exact: true })).toHaveCount(0);
  await expect(page.locator(".wall-now__on-air")).toBeVisible();
  await expect(page.locator(".wall-now__progress, .wall-now__time")).toHaveCount(0);
  const titleMetrics = await page.locator(".wall-now__copy h1").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      overflow: style.overflow,
      lineHeight: Number.parseFloat(style.lineHeight),
      fontSize: Number.parseFloat(style.fontSize),
    };
  });
  expect(titleMetrics.overflow).toBe("visible");
  expect(titleMetrics.lineHeight).toBeGreaterThanOrEqual(titleMetrics.fontSize);
  await expect(page.getByRole("heading", { name: "Song wünschen" })).toBeVisible();
  const largeQr = page.locator(".wall-lineup__invite img");
  await expect(largeQr).toBeVisible();
  const largeQrWidth = await largeQr.evaluate((element) => element.getBoundingClientRect().width);
  await expect(page.getByText("Dance The Night", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Blinding Lights", { exact: true })).toHaveCount(0);
  await expect(page.locator("button, input, select, form")).toHaveCount(0);
  await expect(page.locator(".display-wall__footer")).toHaveCount(0);
  await expect(page.locator(".wall-now__layout")).toHaveClass(/now-track-transition--visible/);

  const desktopLayout = await page.evaluate(() => {
    const player = document.querySelector(".wall-now")?.getBoundingClientRect();
    const queue = document.querySelector(".wall-lineup")?.getBoundingClientRect();
    const vinyl = document.querySelector(".wall-now__art-ring")?.getBoundingClientRect();
    const cover = document.querySelector<HTMLElement>(".wall-now__vinyl .artwork--hero");
    const copy = document.querySelector(".wall-now__copy")?.getBoundingClientRect();
    const title = document.querySelector(".wall-now__copy h1")?.getBoundingClientRect();
    const artist = document.querySelector(".wall-now__copy p")?.getBoundingClientRect();
    const coverBounds = vinyl && cover ? {
      left: vinyl.left + (vinyl.width - cover.offsetWidth) / 2,
      right: vinyl.right - (vinyl.width - cover.offsetWidth) / 2,
      top: vinyl.top + (vinyl.height - cover.offsetHeight) / 2,
      bottom: vinyl.bottom - (vinyl.height - cover.offsetHeight) / 2,
    } : null;
    return {
      playerX: player?.x ?? 0,
      queueX: queue?.x ?? 0,
      playerWidth: player?.width ?? 0,
      vinylWidth: vinyl?.width ?? 0,
      vinylStartsOutside: Boolean(player && vinyl && vinyl.left < player.left),
      playerBounds: player ? { left: player.left, right: player.right, top: player.top, bottom: player.bottom } : null,
      coverBounds,
      copyOverlapsVinyl: Boolean(copy && vinyl && copy.left < vinyl.right),
      copyWidth: copy?.width ?? 0,
      copyTextAlign: getComputedStyle(document.querySelector(".wall-now__copy")!).textAlign,
      progressSpan: getComputedStyle(document.querySelector(".wall-now__art-ring")!).getPropertyValue("--wall-progress-span").trim(),
      progressBackground: getComputedStyle(document.querySelector(".wall-now__art-ring")!, "::before").backgroundImage,
      copySitsAboveCoverCenter: Boolean(coverBounds && copy && title && artist
        && copy.bottom < (coverBounds.top + coverBounds.bottom) / 2),
      copyLayer: Number.parseInt(getComputedStyle(document.querySelector(".wall-now__copy")!).zIndex, 10),
      vinylLayer: Number.parseInt(getComputedStyle(document.querySelector(".wall-now__art-ring")!).zIndex, 10),
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(desktopLayout.queueX).toBeGreaterThan(desktopLayout.playerX);
  expect(desktopLayout.vinylWidth).toBeGreaterThan(desktopLayout.playerWidth * .78);
  expect(desktopLayout.vinylStartsOutside).toBeTruthy();
  expect(desktopLayout.coverBounds?.left).toBeGreaterThanOrEqual((desktopLayout.playerBounds?.left ?? 0) - 2);
  expect(desktopLayout.coverBounds?.right).toBeLessThanOrEqual((desktopLayout.playerBounds?.right ?? 0) + 2);
  expect(desktopLayout.coverBounds?.top).toBeGreaterThanOrEqual((desktopLayout.playerBounds?.top ?? 0) - 2);
  expect(desktopLayout.coverBounds?.bottom).toBeLessThanOrEqual((desktopLayout.playerBounds?.bottom ?? 0) + 2);
  expect(desktopLayout.copyOverlapsVinyl).toBeTruthy();
  expect(desktopLayout.copyWidth).toBeGreaterThan(desktopLayout.playerWidth * .6);
  expect(desktopLayout.copyTextAlign).toBe("left");
  expect(desktopLayout.progressSpan).toBe("360deg");
  expect(desktopLayout.progressBackground).toContain("conic-gradient");
  expect(desktopLayout.copySitsAboveCoverCenter).toBeTruthy();
  expect(desktopLayout.copyLayer).toBeGreaterThan(desktopLayout.vinylLayer);
  expect(desktopLayout.scrollWidth).toBeLessThanOrEqual(desktopLayout.width);
  await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>(".wall-now__copy h1");
    const artist = document.querySelector<HTMLElement>(".wall-now__copy > p");
    if (title) title.textContent = "Everytime We Touch – TEKKNO Version – The Extended Midnight Celebration Remix";
    if (artist) artist.textContent = "Roy Bianco & Die Abbrunzati Boys · Electric Callboy · Florence + The Machine";
    window.dispatchEvent(new Event("resize"));
  });
  await expect.poll(() => page.evaluate(() => {
    const vinyl = document.querySelector<HTMLElement>(".wall-now__art-ring");
    const title = document.querySelector<HTMLElement>(".wall-now__copy h1");
    const artist = document.querySelector<HTMLElement>(".wall-now__copy > p");
    if (!vinyl || !title || !artist) return -1;
    const vinylBounds = vinyl.getBoundingClientRect();
    const insetRatio = Number.parseFloat(getComputedStyle(vinyl).getPropertyValue("--wall-progress-inset")) / 100;
    const progressTop = vinylBounds.top + vinylBounds.height * insetRatio;
    return progressTop - Math.max(title.getBoundingClientRect().bottom, artist.getBoundingClientRect().bottom);
  })).toBeGreaterThan(16);
  const longCopySafety = await page.evaluate(() => {
    const layout = document.querySelector(".wall-now__layout")?.getBoundingClientRect();
    const vinyl = document.querySelector<HTMLElement>(".wall-now__art-ring");
    const copy = document.querySelector<HTMLElement>(".wall-now__copy");
    const title = document.querySelector<HTMLElement>(".wall-now__copy h1");
    const artist = document.querySelector<HTMLElement>(".wall-now__copy > p");
    if (!layout || !vinyl || !copy || !title || !artist) return null;
    const vinylBounds = vinyl.getBoundingClientRect();
    const copyBounds = copy.getBoundingClientRect();
    const titleBounds = title.getBoundingClientRect();
    const artistBounds = artist.getBoundingClientRect();
    const style = getComputedStyle(vinyl);
    const insetRatio = Number.parseFloat(style.getPropertyValue("--wall-progress-inset")) / 100;
    const progressTop = vinylBounds.top + vinylBounds.height * insetRatio;
    return {
      fitScale: Number.parseFloat(copy.dataset.fitScale ?? "1"),
      leftGap: copyBounds.left - layout.left,
      rightGap: layout.right - copyBounds.right,
      topGap: copyBounds.top - layout.top,
      progressGap: progressTop - Math.max(titleBounds.bottom, artistBounds.bottom),
      contentFitsHeight: copy.scrollHeight <= copy.clientHeight + 1,
      contentFitsWidth: copy.scrollWidth <= copy.clientWidth + 1,
    };
  });
  expect(longCopySafety).not.toBeNull();
  expect(longCopySafety!.fitScale).toBeLessThan(1);
  expect(longCopySafety!.leftGap).toBeGreaterThan(20);
  expect(longCopySafety!.rightGap).toBeGreaterThan(20);
  expect(longCopySafety!.topGap).toBeGreaterThan(40);
  expect(longCopySafety!.progressGap).toBeGreaterThan(16);
  expect(longCopySafety!.contentFitsHeight).toBeTruthy();
  expect(longCopySafety!.contentFitsWidth).toBeTruthy();
  const ambientMotion = await page.evaluate(() => {
    const vinyl = getComputedStyle(document.querySelector(".wall-now__vinyl")!);
    const firstWave = getComputedStyle(document.querySelector(".display-wall-page")!, "::before");
    const secondWave = getComputedStyle(document.querySelector(".display-wall-page")!, "::after");
    return {
      vinylName: vinyl.animationName,
      vinylDuration: Number.parseFloat(vinyl.animationDuration),
      firstWaveName: firstWave.animationName,
      firstWaveDuration: Number.parseFloat(firstWave.animationDuration),
      secondWaveName: secondWave.animationName,
      secondWaveDuration: Number.parseFloat(secondWave.animationDuration),
    };
  });
  expect(ambientMotion.vinylName).toContain("wall-record-spin");
  expect(ambientMotion.vinylDuration).toBeCloseTo(2.7, 1);
  expect(ambientMotion.firstWaveName).toContain("wall-wave-drift-a");
  expect(ambientMotion.firstWaveDuration).toBeGreaterThanOrEqual(20);
  expect(ambientMotion.secondWaveName).toContain("wall-wave-drift-b");
  expect(ambientMotion.secondWaveDuration).toBeGreaterThanOrEqual(25);

  const requested = await request.post(`/api/parties/${admin.party.party.code}/requests`, { data: { trackId: "demo-2" } });
  expect(requested.ok()).toBeTruthy();
  showManyWishes = true;
  await page.reload();

  await expect(page.getByText("Dance The Night", { exact: true })).toBeVisible();
  await expect(page.getByText("Blinding Lights", { exact: true })).toHaveCount(0);
  await expect(page.locator(".wall-lineup__invite")).toHaveCount(0);
  const compactQr = page.locator(".wall-lineup__scan img");
  await expect(compactQr).toBeVisible();
  await expect(page.locator(".wall-lineup__scan small")).toHaveCount(0);
  const compactQrWidth = await compactQr.evaluate((element) => element.getBoundingClientRect().width);
  expect(compactQrWidth).toBeGreaterThanOrEqual(280);
  expect(largeQrWidth).toBeGreaterThan(compactQrWidth);
  await expect(page.getByText("Live nach Stimmen sortiert", { exact: true })).toHaveCount(0);
  await expect.poll(() => page.locator(".wall-lineup__item").count()).toBeGreaterThan(1);
  const desktopCueCount = await page.locator(".wall-lineup__item").count();
  expect(desktopCueCount).toBeLessThanOrEqual(6);
  const qrAlignment = await page.evaluate(() => {
    const footer = document.querySelector(".wall-lineup__footer")!.getBoundingClientRect();
    const label = document.querySelector(".wall-lineup__scan > span")!.getBoundingClientRect();
    const qr = document.querySelector(".wall-lineup__scan img")!.getBoundingClientRect();
    const footerCenter = footer.left + footer.width / 2;
    return {
      labelOffset: Math.abs(label.left + label.width / 2 - footerCenter),
      qrOffset: Math.abs(qr.left + qr.width / 2 - footerCenter),
      labelBelowQr: label.top >= qr.bottom,
    };
  });
  expect(qrAlignment.labelOffset).toBeLessThan(4);
  expect(qrAlignment.qrOffset).toBeLessThan(4);
  expect(qrAlignment.labelBelowQr).toBeTruthy();
  const queueTopGap = await page.evaluate(() => {
    const heading = document.querySelector(".wall-lineup__heading")?.getBoundingClientRect();
    const item = document.querySelector(".wall-lineup__item")?.getBoundingClientRect();
    return (item?.top ?? 0) - (heading?.bottom ?? 0);
  });
  expect(queueTopGap).toBeGreaterThanOrEqual(0);
  expect(queueTopGap).toBeLessThan(60);

  await expect(page.locator(".wall-now__layout")).toHaveClass(/now-track-transition--visible/);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => {
    const player = document.querySelector(".wall-now")?.getBoundingClientRect();
    const queue = document.querySelector(".wall-lineup")?.getBoundingClientRect();
    const vinyl = document.querySelector(".wall-now__art-ring")?.getBoundingClientRect();
    const cover = document.querySelector<HTMLElement>(".wall-now__vinyl .artwork--hero");
    const coverBounds = vinyl && cover ? {
      left: vinyl.left + (vinyl.width - cover.offsetWidth) / 2,
      right: vinyl.right - (vinyl.width - cover.offsetWidth) / 2,
      top: vinyl.top + (vinyl.height - cover.offsetHeight) / 2,
      bottom: vinyl.bottom - (vinyl.height - cover.offsetHeight) / 2,
    } : null;
    return {
      playerY: player?.y ?? 0,
      queueY: queue?.y ?? 0,
      vinylStartsOutside: Boolean(player && vinyl && vinyl.left < player.left),
      playerBounds: player ? { left: player.left, right: player.right, top: player.top, bottom: player.bottom } : null,
      coverBounds,
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(mobileLayout.queueY).toBeGreaterThan(mobileLayout.playerY);
  expect(mobileLayout.vinylStartsOutside).toBeTruthy();
  expect(mobileLayout.coverBounds?.left).toBeGreaterThanOrEqual(mobileLayout.playerBounds?.left ?? 0);
  expect(mobileLayout.coverBounds?.right).toBeLessThanOrEqual(mobileLayout.playerBounds?.right ?? 0);
  expect(mobileLayout.coverBounds?.top).toBeGreaterThanOrEqual(mobileLayout.playerBounds?.top ?? 0);
  expect(mobileLayout.coverBounds?.bottom).toBeLessThanOrEqual(mobileLayout.playerBounds?.bottom ?? 0);
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.width);
  await expect.poll(() => page.locator(".wall-lineup__item").count()).toBeLessThanOrEqual(desktopCueCount);
  const mobileCueCount = await page.locator(".wall-lineup__item").count();
  expect(mobileCueCount).toBeGreaterThan(0);
  const mobileQueueFits = await page.evaluate(() => {
    const list = document.querySelector(".wall-lineup__list")?.getBoundingClientRect();
    const lastItem = document.querySelector(".wall-lineup__item:last-child")?.getBoundingClientRect();
    return !list || !lastItem || lastItem.bottom <= list.bottom + 1;
  });
  expect(mobileQueueFits).toBeTruthy();
  await expect(compactQr).toBeVisible();
});

test("Adminfluss ist auf mobilen Viewports vollständig erreichbar", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-demo-admin": "true" });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wiedergabe" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Song sofort spielen" })).toHaveCount(0);
  const displayWallLink = page.getByRole("link", { name: /Display Wall öffnen/ });
  await expect(displayWallLink).toBeVisible();
  await expect(displayWallLink).toHaveAttribute("href", /\/p\/[A-Za-z0-9_-]+\/display$/);
  const player = page.getByRole("region", { name: "Spotify Player" });
  await expect(player).toBeVisible();
  await expect(player.getByText("Midnight City", { exact: true })).toBeVisible();
  await expect(player.getByRole("button", { name: "Wiedergabe pausieren" })).toBeVisible();
  await player.getByRole("button", { name: "Wiedergabe pausieren" }).click();
  await expect(player.getByRole("button", { name: "Wiedergabe fortsetzen" })).toBeVisible();
  await player.getByRole("button", { name: "Wiedergabe fortsetzen" }).click();
  await expect(player.getByRole("button", { name: "Wiedergabe pausieren" })).toBeVisible();
  await expect(player.getByRole("button", { name: "Nächsten Titel abspielen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Geräteliste aktualisieren" })).toBeVisible();
  await expect(page.getByRole("option", { name: /Party iPhone/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Geräteliste aktualisieren" }).click();
  await expect(page.getByRole("option", { name: /Party iPhone/ })).toBeAttached();
  await expect(page.getByRole("button", { name: "Party beenden" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("Admin kann QR-Druckvorlagen konfigurieren und als PDF laden", async ({ page }, testInfo) => {
  await page.setExtraHTTPHeaders({ "x-demo-admin": "true" });
  await page.goto("/admin");
  await page.getByRole("button", { name: "QR-Code drucken & exportieren" }).click();

  const dialog = page.getByRole("dialog", { name: "QR-Code exportieren" });
  await expect(dialog).toBeVisible();

  const posterDownloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "A4-PDF herunterladen" }).click();
  const posterDownload = await posterDownloadPromise;
  expect(posterDownload.suggestedFilename()).toMatch(/a4-plakat-farbe\.pdf$/);
  if (process.env.QR_QA_DIR) await posterDownload.saveAs(`${process.env.QR_QA_DIR}/${testInfo.project.name}-poster-farbe.pdf`);

  await dialog.getByRole("radio", { name: /Kartenbogen/ }).check();
  await dialog.getByLabel("Anzahl pro A4-Seite").selectOption("8");
  await expect(dialog.getByText("Scan & Play")).toHaveCount(8);
  const clippedEightCardText = await dialog.locator(".qr-preview-card small, .qr-preview-card strong, .qr-preview-card em").evaluateAll((elements) =>
    elements.flatMap((element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight
      ? [{ text: element.textContent, client: [element.clientWidth, element.clientHeight], scroll: [element.scrollWidth, element.scrollHeight] }]
      : []),
  );
  expect(clippedEightCardText).toEqual([]);

  const eightCardDownloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "A4-PDF herunterladen" }).click();
  const eightCardDownload = await eightCardDownloadPromise;
  expect(eightCardDownload.suggestedFilename()).toMatch(/a4-8-karten-farbe\.pdf$/);
  if (process.env.QR_QA_DIR) await eightCardDownload.saveAs(`${process.env.QR_QA_DIR}/${testInfo.project.name}-8-karten-farbe.pdf`);

  await dialog.getByLabel("Anzahl pro A4-Seite").selectOption("12");
  await dialog.getByRole("radio", { name: /Schwarzweiß/ }).check();
  await expect(dialog.getByText("Scan & Play")).toHaveCount(12);
  const clippedPreviewText = await dialog.locator(".qr-preview-card small, .qr-preview-card strong, .qr-preview-card em").evaluateAll((elements) =>
    elements.flatMap((element) => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight
      ? [{ text: element.textContent, client: [element.clientWidth, element.clientHeight], scroll: [element.scrollWidth, element.scrollHeight] }]
      : []),
  );
  expect(clippedPreviewText).toEqual([]);

  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "A4-PDF herunterladen" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/a4-12-karten-laser\.pdf$/);
  if (process.env.QR_QA_DIR) await download.saveAs(`${process.env.QR_QA_DIR}/${testInfo.project.name}-karten-laser.pdf`);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const pdf = Buffer.concat(chunks);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(10_000);
});
