import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
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

test("Gast kann mobil suchen, wünschen und voten", async ({ page, request }) => {
  const response = await request.get("/api/admin/state", { headers: { "x-demo-admin": "true" } });
  const admin = await response.json();
  await page.goto(`/p/${admin.party.party.code}`);

  await expect(page.getByRole("heading", { name: "Mobile Testparty" })).toBeVisible();
  const resumedStateRequest = page.waitForRequest((request) =>
    request.method() === "GET" && request.url().includes(`/api/parties/${admin.party.party.code}/state`),
  );
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await resumedStateRequest;
  await expect(page.getByRole("region", { name: "Song finden" })).toBeVisible();
  await expect(page.getByText("3 Wünsche frei")).toBeVisible();
  await page.getByRole("searchbox", { name: "Song oder Künstler suchen" }).fill("Dua");
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

test("Adminfluss ist auf mobilen Viewports vollständig erreichbar", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-demo-admin": "true" });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Wiedergabe" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Song sofort spielen" })).toHaveCount(0);
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
