import { expect, test } from "@playwright/test";
import { dismissCookies, expectNoHorizontalScroll } from "./helpers";

const PAGES = ["/", "/tarifs", "/faq", "/blog", "/blog/rimes-multisyllabiques", "/legal/cgu", "/legal/confidentialite", "/connexion", "/inscription"];

test.describe("site public (375 px)", () => {
  for (const path of PAGES) {
    test(`${path} s'affiche sans défilement horizontal`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await dismissCookies(page);
      await expect(page.locator("h1").first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }

  test("la landing montre des paroles avec syllabes et rimes colorées", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("comme toi");
    await expect(page.locator(".rhyme").first()).toBeVisible();
    await expect(page.getByLabel(/syllabes/).first()).toBeVisible();
  });

  test("le bandeau cookies permet de refuser aussi facilement qu'accepter", async ({ page }) => {
    await page.goto("/faq");
    await expect(page.getByRole("button", { name: "Accepter" })).toBeVisible();
    await page.getByRole("button", { name: "Refuser" }).click();
    await expect(page.getByRole("button", { name: "Accepter" })).toBeHidden();
  });

  test("inscription à la liste d'attente", async ({ page }) => {
    await page.goto("/#liste-attente");
    await dismissCookies(page);
    await page.getByLabel("E-mail").fill(`wl-${Date.now()}@flowrima.test`);
    await page.getByRole("button", { name: "Rejoindre la liste d'attente" }).last().click();
    await expect(page.getByText("C'est noté")).toBeVisible();
  });

  test("l'espace /app est protégé", async ({ page }) => {
    await page.goto("/app/studio");
    await expect(page).toHaveURL(/\/connexion\?next=%2Fapp%2Fstudio/);
  });

  test("les API refusent les requêtes non authentifiées", async ({ request }) => {
    expect((await request.post("/api/generate/lyrics", { data: {} })).status()).toBe(401);
    expect((await request.get("/api/account/export")).status()).toBe(401);
  });
});
