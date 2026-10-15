import { COMPANY, DraftNotice, LEGAL_UPDATED } from "./common";

export const title = "Conditions générales de vente";

export default function Cgv() {
  return (
    <>
      <DraftNotice />
      <p>Dernière mise à jour : {LEGAL_UPDATED}</p>
      <h2>1. Offres</h2>
      <p>
        Flowrima propose une offre gratuite (Découverte) et des abonnements payants (Artiste, puis Pro et Label/Studio), ainsi que des packs
        de crédits à l&apos;unité. Le détail des offres et des quotas figure sur la page Tarifs au jour de la souscription.
      </p>
      <h2>2. Prix et TVA</h2>
      <p>
        Les prix sont indiqués en euros toutes taxes comprises. La TVA applicable est calculée automatiquement selon le pays de résidence du
        client (Stripe Tax). Une facture est disponible dans l&apos;espace de gestion de l&apos;abonnement.
      </p>
      <h2>3. Essai gratuit</h2>
      <p>
        L&apos;offre Artiste peut comprendre un essai gratuit de 7 jours. Sauf résiliation avant la fin de l&apos;essai, l&apos;abonnement devient
        payant à son terme. Un rappel est envoyé avant la fin de l&apos;essai.
      </p>
      <h2>4. Paiement et renouvellement</h2>
      <p>
        Le paiement est effectué par carte via notre prestataire Stripe. L&apos;abonnement est renouvelé automatiquement à chaque échéance
        (mensuelle ou annuelle). En cas d&apos;échec de paiement, de nouvelles tentatives sont effectuées et le client est informé ; à défaut de
        régularisation, l&apos;abonnement repasse sur l&apos;offre gratuite.
      </p>
      <h2>5. Droit de rétractation — contenu numérique</h2>
      <p>
        Conformément à l&apos;article L221-28 13° du Code de la consommation, le droit de rétractation ne peut être exercé pour la fourniture
        d&apos;un contenu numérique non fourni sur un support matériel dont l&apos;exécution a commencé avec l&apos;accord préalable exprès du
        consommateur et sa renonciation expresse à son droit de rétractation. Lors de la souscription, tu demandes l&apos;accès immédiat au
        service et renonces expressément à ce droit ; cette renonciation est horodatée. À défaut, tu disposes d&apos;un délai de 14 jours pour te
        rétracter.
      </p>
      <h2>6. Résiliation</h2>
      <p>
        Tu peux résilier à tout moment, en un clic, depuis la page Compte (portail de gestion). La résiliation prend effet à la fin de la
        période en cours ; les quotas restent disponibles jusque-là. Les crédits mensuels non utilisés ne sont pas reportés ; les crédits
        achetés en pack restent valables tant que le compte existe.
      </p>
      <h2>7. Marketplace de prods (phase ultérieure)</h2>
      <p>
        Les licences de prods (simple ou exclusive) sont vendues par les beatmakers partenaires via Flowrima, qui perçoit une commission. Un
        contrat de licence est généré à chaque achat ; les vendeurs sont vérifiés par notre prestataire de paiement (KYC Stripe Connect).
      </p>
      <h2>8. Contact et médiation</h2>
      <p>
        Service client : {COMPANY.email}. En cas de litige, tu peux recourir gratuitement au médiateur de la consommation [nom et coordonnées]
        ou à la plateforme européenne de règlement en ligne des litiges.
      </p>
    </>
  );
}
