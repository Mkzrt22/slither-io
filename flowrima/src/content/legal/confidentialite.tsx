import { COMPANY, DraftNotice, LEGAL_UPDATED } from "./common";

export const title = "Politique de confidentialité";

export default function Confidentialite() {
  return (
    <>
      <DraftNotice />
      <p>Dernière mise à jour : {LEGAL_UPDATED}</p>
      <h2>Responsable du traitement</h2>
      <p>
        {COMPANY.name}, {COMPANY.address}. Délégué à la protection des données : {COMPANY.dpo}.
      </p>
      <h2>Données traitées et finalités</h2>
      <ul>
        <li>Compte : e-mail, nom affiché, préférences — exécution du contrat.</li>
        <li>Profil artiste et titres importés (paroles, liens, métadonnées) — exécution du contrat (analyse de ton ADN, génération).</li>
        <li>Projets et versions de paroles — exécution du contrat.</li>
        <li>Facturation (via Stripe, nous ne stockons pas ta carte) — obligation légale et contrat.</li>
        <li>Journal d&apos;usage et de coûts (nombre de générations, tokens) — intérêt légitime (quotas, prévention des abus, pilotage).</li>
        <li>Mesure d&apos;audience (PostHog, UE) — uniquement avec ton consentement.</li>
        <li>Registre des consentements (attestation de droits, CGU, cookies, opt-in) — obligation légale et preuve.</li>
      </ul>
      <h2>Intelligence artificielle</h2>
      <p>
        Pour te fournir le service, tes paroles et ton ADN sont transmis à notre fournisseur d&apos;IA (Anthropic) dans le cadre d&apos;un accord de
        traitement des données. <strong>Aucun entraînement de modèle n&apos;est réalisé sur tes données sans ton opt-in explicite</strong>, désactivé
        par défaut. Les contenus importés sont traités comme des données et jamais comme des instructions.
      </p>
      <h2>Sous-traitants</h2>
      <ul>
        <li>Supabase (base de données, authentification, fichiers) — hébergement dans l&apos;UE.</li>
        <li>Vercel (hébergement de l&apos;application) — fonctions exécutées dans l&apos;UE.</li>
        <li>Anthropic (modèles d&apos;IA) — transferts encadrés par les clauses contractuelles types.</li>
        <li>Stripe (paiement, TVA), Resend (e-mails), Inngest (tâches de fond), PostHog UE (audience), Sentry (erreurs).</li>
      </ul>
      <p>Un accord de traitement (DPA) est signé avec chacun d&apos;eux.</p>
      <h2>Durées de conservation</h2>
      <ul>
        <li>Données du compte et contenus : tant que le compte existe ; suppression à la clôture.</li>
        <li>Factures : 10 ans (obligation comptable).</li>
        <li>Journaux techniques : 12 mois. Adresses IP : jamais stockées en clair (empreinte salée).</li>
        <li>Liste d&apos;attente : jusqu&apos;à ta désinscription ou 24 mois.</li>
      </ul>
      <h2>Tes droits</h2>
      <p>
        Accès, rectification, effacement, portabilité, limitation, opposition et retrait du consentement. <strong>Export et suppression en un
        clic</strong> depuis la page Compte. Pour toute autre demande : {COMPANY.dpo}. Tu peux introduire une réclamation auprès de la CNIL.
      </p>
      <h2>Sécurité</h2>
      <p>
        Chiffrement en transit, cloisonnement des données par utilisateur au niveau de la base (Row Level Security), fichiers privés accessibles
        uniquement par liens signés à durée courte, journal d&apos;audit, sauvegardes quotidiennes.
      </p>
    </>
  );
}
