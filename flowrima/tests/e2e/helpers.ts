import { expect, type Page } from "@playwright/test";

/** Acceptance criterion: usable at 375 px without horizontal scrolling. */
export async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `scrollWidth ${scrollWidth} > viewport ${innerWidth}`).toBeLessThanOrEqual(innerWidth);
}

export async function dismissCookies(page: Page) {
  const refuse = page.getByRole("button", { name: "Refuser" });
  if (await refuse.isVisible().catch(() => false)) await refuse.click();
}

export const LYRICS = [
  `[Couplet 1]
J'ai grandi dans le béton sans jamais baisser les yeux
Les lampadaires comme témoins de nos promesses entre deux feux
Le quartier dort mais moi je compte encore les heures
J'écris la nuit pour que ma mère n'ait plus jamais peur

[Refrain]
Encore une nuit (encore)
Encore un cri
Sous les néons de la ville
Je tiens sur un fil`,
  `[Couplet 1]
Mon cœur est froid comme le bitume en hiver
J'ai pas connu la lumière avant d'écrire mes premiers vers
Les potes partent un par un la vie c'est pas une fête
J'garde le cap et les rêves bien rangés dans ma tête

[Refrain]
Toujours debout (yeah)
Même quand tout tombe
Toujours debout
Je sors de l'ombre`,
  `[Couplet 1]
On compte les billets dans la cage d'escalier
Les grands m'ont appris que rien n'est jamais oublié
J'avance seul dans la zone avec mes doutes en bandoulière
Et chaque rime que j'écris me rapproche de la lumière

[Refrain]
La zone (la zone)
Me connaît par cœur
La zone
Garde mes heures`,
];
