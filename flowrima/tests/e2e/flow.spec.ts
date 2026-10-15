import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { dismissCookies, expectNoHorizontalScroll, LYRICS } from "./helpers";

/**
 * Full artist journey on a 375 px phone, against a local Supabase and the mock
 * LLM. Covers the acceptance criteria of the spec (§14).
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_local_e2e_secret";
const PRICE = process.env.STRIPE_PRICE_ARTIST_MONTHLY ?? "price_test_artist_monthly";

const visible = (page: Page, name: string | RegExp) => page.getByRole("button", { name }).filter({ visible: true }).first();

async function signUp(page: Page, email: string) {
  await page.goto("/inscription");
  await dismissCookies(page);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Mot de passe").fill("motdepasse-e2e-1");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding/);
}

async function generate(page: Page) {
  await visible(page, /Nouvelles propositions|Écrire 3 propositions/).click();
  await page.getByRole("dialog").getByRole("button", { name: "Écrire 3 propositions" }).click();
}

test("parcours complet d'un artiste (mobile 375 px)", async ({ page, browser, request }) => {
  test.skip(!SERVICE_KEY, "SUPABASE_SERVICE_ROLE_KEY manquant : lance Supabase local et remplis .env.local (voir docs/TESTING.md).");
  test.setTimeout(300_000);
  const email = `artist-${Date.now()}@flowrima.test`;
  let projectUrl = "";
  let txtHref = "";

  await test.step("inscription et profil artiste", async () => {
    await signUp(page, email);
    await page.getByLabel("Nom de scène").fill("Nox E2E");
    await page.getByText("Rap", { exact: true }).click();
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByRole("heading", { name: "Importe tes titres" })).toBeVisible();
  });

  await test.step("import de 3 titres avec attestation de droits", async () => {
    for (let i = 0; i < 3; i++) {
      if (i > 0) await page.getByRole("button", { name: "Ajouter un autre titre" }).click();
      await page.getByLabel("Titre", { exact: true }).nth(i).fill(`Titre ${i + 1}`);
      await page.getByLabel("Date de sortie").nth(i).fill(`202${i + 2}-03-01`);
      await page.getByLabel("Paroles", { exact: true }).nth(i).fill(LYRICS[i]);
    }
    // Without the rights attestation the form cannot be submitted
    const attest = page.getByRole("checkbox", { name: /Je suis l'auteur/ });
    await page.getByRole("button", { name: "Importer", exact: true }).click();
    expect(await attest.evaluate((el) => (el as HTMLInputElement).checkValidity())).toBe(false);
    await expect(page.getByText("3 titre(s) importé(s)")).toBeHidden();
    await attest.check();
    await page.getByRole("button", { name: "Importer", exact: true }).click();
    await expect(page.getByText("3 titre(s) importé(s)")).toBeVisible();
    await page.getByRole("button", { name: /Continuer \(3 titres\)/ }).click();
  });

  await test.step("analyse ADN en moins de 2 minutes, affichée visuellement", async () => {
    const started = Date.now();
    await page.getByRole("button", { name: "Analyser mon catalogue" }).click();
    // Live job status, then the wizard refreshes and offers to open the DNA
    await expect(page.getByText("Ton ADN est prêt").or(page.getByRole("link", { name: "Voir mon ADN" }))).toBeVisible({ timeout: 120_000 });
    expect(Date.now() - started).toBeLessThan(120_000);
    await page.goto("/app/adn");
    await expect(page.getByRole("heading", { name: "Ta signature en 5 points" })).toBeVisible();
    await expect(page.getByRole("img", { name: /Radar des thèmes/ })).toBeVisible();
    await expect(page.getByRole("meter", { name: "Fiabilité de l'ADN" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step("génération : 3 versions complètes, balisées, syllabes et rimes visibles", async () => {
    await page.goto("/app/studio");
    await page.getByLabel("Sujet ou thème").fill("la dernière nuit avant de quitter mon quartier");
    await page.getByRole("button", { name: "Écrire 3 propositions" }).click();
    await expect(page).toHaveURL(/\/app\/studio\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    projectUrl = new URL(page.url()).pathname;
    for (const v of ["A — Fidèle", "B — Évolution", "C — Audace"]) {
      await expect(page.getByRole("tab", { name: v })).toBeVisible();
    }
    await expect(page.locator("h3", { hasText: "[Couplet 1]" }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator(".rhyme").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByLabel(/^\d+ syllabes$/).filter({ visible: true }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  await test.step("éditeur ligne par ligne et sauvegarde automatique", async () => {
    await visible(page, "Travailler cette version").click();
    await page.getByRole("button", { name: /^Modifier la ligne/ }).first().click();
    const line = page.getByRole("textbox", { name: /Ligne 1 de/ });
    await line.fill("Je pars ce soir, / la ville s'endort sans moi");
    await expect(page.getByRole("button", { name: "Plus punchy" })).toBeVisible();
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByText("Enregistré", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
  });

  await test.step("export TXT (tous plans) et PDF réservé au plan Artiste", async () => {
    txtHref = (await page.getByRole("link", { name: "TXT" }).getAttribute("href")) ?? "";
    const txt = await page.request.get(txtHref);
    expect(txt.status()).toBe(200);
    const body = await txt.text();
    expect(body).toContain("[Couplet 1]");
    expect(body).toContain("Je pars ce soir");
    expect(body).toContain("Généré avec l'IA");
    await page.getByRole("button", { name: "PDF" }).click();
    await expect(page.getByRole("dialog", { name: "Limite atteinte" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("utilisateur gratuit bloqué proprement au 4e essai", async () => {
    await generate(page);
    await expect(page.getByText("3 propositions prêtes")).toBeVisible({ timeout: 60_000 });
    await generate(page);
    await expect(page.getByText("3 propositions prêtes").first()).toBeVisible({ timeout: 60_000 });
    await generate(page);
    await expect(page.getByText("Quota de générations atteint")).toBeVisible({ timeout: 30_000 });
    await visible(page, "Passer au plan Artiste").click();
    await expect(page.getByRole("dialog", { name: "Limite atteinte" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Passer au plan Artiste/ })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("un paiement Stripe (webhook signé) débloque l'accès immédiatement", async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: profile } = await admin.from("profiles").select("id").eq("email", email).single();
    const now = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      id: `evt_e2e_${now}`, object: "event", type: "customer.subscription.updated", api_version: "2026-09-30.endive",
      created: now, livemode: false, pending_webhooks: 1, request: null,
      data: { object: {
        id: `sub_e2e_${now}`, object: "subscription", customer: `cus_e2e_${now}`, status: "active",
        cancel_at_period_end: false, trial_end: null, metadata: { user_id: profile!.id },
        items: { object: "list", data: [{ id: "si_e2e", object: "subscription_item", current_period_start: now, current_period_end: now + 30 * 86400,
          price: { id: PRICE, object: "price", recurring: { interval: "month" } } }] },
      } },
    });
    const signature = new Stripe("sk_test_dummy").webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const res = await request.post("/api/stripe/webhook", { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
    expect(res.status()).toBe(200);
    const forged = await request.post("/api/stripe/webhook", { data: payload, headers: { "stripe-signature": "t=1,v1=forged" } });
    expect(forged.status()).toBe(400);

    await page.reload();
    await generate(page);
    await expect(page.getByText("3 propositions prêtes")).toBeVisible({ timeout: 60_000 });
  });

  await test.step("avec 5 titres importés (plan Artiste), l'ADN est généré en moins de 2 minutes", async () => {
    await page.goto("/app/catalogue/nouveau");
    for (let i = 0; i < 2; i++) {
      if (i > 0) await page.getByRole("button", { name: "Ajouter un autre titre" }).click();
      await page.getByLabel("Titre", { exact: true }).nth(i).fill(`Titre ${i + 4}`);
      await page.getByLabel("Date de sortie").nth(i).fill(`202${i + 5}-03-01`);
      await page.getByLabel("Paroles", { exact: true }).nth(i).fill(LYRICS[i]);
    }
    await page.getByRole("checkbox", { name: /Je suis l'auteur/ }).check();
    await page.getByRole("button", { name: "Importer", exact: true }).click();
    await expect(page.getByText("2 titre(s) importé(s)")).toBeVisible();

    await page.goto("/app/adn");
    const started = Date.now();
    await page.getByRole("button", { name: "Mettre à jour mon ADN" }).click();
    await expect(page.getByText(/5 titres/)).toBeVisible({ timeout: 120_000 });
    expect(Date.now() - started).toBeLessThan(120_000);
    await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /Radar des thèmes/ })).toBeVisible();
  });

  await test.step("pages de l'app utilisables à 375 px", async () => {
    for (const path of ["/app", "/app/catalogue", "/app/projets", "/app/compte", "/app/prod"]) {
      await page.goto(path);
      await expect(page.locator("h1").first()).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
    const exp = await page.request.get("/api/account/export");
    expect(exp.status()).toBe(200);
    expect(JSON.stringify(await exp.json())).toContain("Nox E2E");
  });

  await test.step("un autre utilisateur ne peut jamais lire ces données", async () => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const other = await ctx.newPage();
    await signUp(other, `intrus-${Date.now()}@flowrima.test`);
    await other.goto(projectUrl);
    await expect(other.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
    expect((await other.request.get(txtHref)).status()).toBe(404);

    await other.goto("/app/compte");
    await other.getByRole("button", { name: "Supprimer mon compte" }).click();
    await other.getByLabel("Tape SUPPRIMER pour confirmer").fill("SUPPRIMER");
    await other.getByRole("button", { name: "Supprimer définitivement" }).click();
    await expect(other).toHaveURL(/compte=supprime/);
    await ctx.close();
  });
});
