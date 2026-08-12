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
  await page.getByRole("searchbox", { name: "Song oder Künstler suchen" }).fill("Dua");
  await expect(page.getByRole("button", { name: /Song wünschen: Dance The Night/ })).toBeVisible();
  await page.getByRole("button", { name: /Song wünschen: Dance The Night/ }).click();
  await expect(page.getByRole("region", { name: "Song finden" }).getByRole("status")).toContainText(/gewünscht|Stimme/);
  await expect(page.getByRole("searchbox", { name: "Song oder Künstler suchen" })).toHaveValue("Dua");
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
  await expect(page.getByRole("button", { name: "Party beenden" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
