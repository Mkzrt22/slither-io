import { DraftNotice, LEGAL_UPDATED } from "./common";

export const title = "Politique cookies";

export default function Cookies() {
  return (
    <>
      <DraftNotice />
      <p>Dernière mise à jour : {LEGAL_UPDATED}</p>
      <h2>Cookies essentiels (toujours actifs)</h2>
      <ul>
        <li>Session d&apos;authentification (Supabase) — te garder connecté.</li>
        <li>Préférences locales (thème, choix cookies) — stockées dans ton navigateur.</li>
        <li>Paiement (Stripe) — sécurisation du paiement lors de la souscription.</li>
      </ul>
      <h2>Mesure d&apos;audience (avec consentement)</h2>
      <p>
        PostHog, hébergé dans l&apos;UE, mesure l&apos;usage des fonctionnalités pour améliorer le produit. Il n&apos;est chargé qu&apos;après ton
        accord. Durée : 13 mois maximum.
      </p>
      <h2>Modifier ton choix</h2>
      <p>À tout moment via le lien « Gérer les cookies » en bas de page. Refuser est aussi simple qu&apos;accepter.</p>
    </>
  );
}
