import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";
import { siteUrl } from "@/lib/utils";

/** Transactional e-mails (Resend). Silently skipped when RESEND_API_KEY is not set. */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const e = env();
  if (!e.RESEND_API_KEY) return false;
  try {
    const resend = new Resend(e.RESEND_API_KEY);
    const { error } = await resend.emails.send({ from: e.EMAIL_FROM, to, subject, html });
    return !error;
  } catch {
    return false;
  }
}

const wrap = (body: string) => `<!doctype html><html lang="fr"><body style="margin:0;background:#0b0b10;color:#f1f1f4;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<p style="font-size:20px;font-weight:700;margin:0 0 24px"><span style="color:#c6ff2e">▮</span> Flowrima</p>
${body}
<p style="margin-top:32px;font-size:12px;color:#a6a6ba">Flowrima — studio d'écriture IA pour artistes. <a style="color:#c6ff2e" href="${siteUrl()}/legal/confidentialite">Confidentialité</a></p>
</div></body></html>`;

export const emails = {
  waitlist: (artistName?: string | null) =>
    wrap(`<p>Salut ${artistName ? escapeHtml(artistName) : ""} 👋</p>
<p>Tu es sur la liste d'attente de Flowrima. On t'écrit dès que ton accès est prêt.</p>
<p>Tu as coché l'entretien ? On te contacte pour 20 minutes d'échange sur ta manière d'écrire : c'est ce qui construit le produit.</p>`),
  welcome: () =>
    wrap(`<p>Bienvenue dans ton studio !</p>
<p>Prochaine étape : importe 3 titres déjà sortis pour générer ton ADN artistique.</p>
<p><a style="display:inline-block;background:#c6ff2e;color:#0b0b10;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700" href="${siteUrl()}/app/onboarding">Configurer mon studio</a></p>`),
  paymentFailed: () =>
    wrap(`<p>Ton dernier paiement Flowrima n'est pas passé.</p>
<p>Pas d'inquiétude : on réessaie automatiquement dans les prochains jours. Pour garder ton plan sans interruption, mets à jour ton moyen de paiement.</p>
<p><a style="display:inline-block;background:#c6ff2e;color:#0b0b10;padding:12px 18px;border-radius:12px;text-decoration:none;font-weight:700" href="${siteUrl()}/app/compte">Mettre à jour mon paiement</a></p>`),
  subscriptionStarted: (plan: string) =>
    wrap(`<p>C'est parti : ton plan <strong>${escapeHtml(plan)}</strong> est actif.</p>
<p>Tes nouveaux quotas sont disponibles immédiatement dans le studio.</p>`),
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
