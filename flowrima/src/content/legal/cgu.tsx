import { COMPANY, DraftNotice, LEGAL_UPDATED } from "./common";

export const title = "Conditions générales d'utilisation";

export default function Cgu() {
  return (
    <>
      <DraftNotice />
      <p>Dernière mise à jour : {LEGAL_UPDATED}</p>
      <h2>1. Objet</h2>
      <p>
        Les présentes conditions régissent l&apos;utilisation de Flowrima, studio d&apos;écriture assisté par intelligence artificielle
        permettant d&apos;analyser le style d&apos;un artiste à partir de ses titres et de proposer des paroles inédites.
      </p>
      <h2>2. Compte</h2>
      <p>
        L&apos;inscription est réservée aux personnes de 15 ans et plus (avec l&apos;accord d&apos;un représentant légal pour les mineurs de
        moins de 18 ans pour les offres payantes). Tu es responsable de la confidentialité de tes identifiants.
      </p>
      <h2>3. Titres importés : tes garanties</h2>
      <p>En important des titres (paroles, fichiers audio, liens), tu déclares et garantis :</p>
      <ul>
        <li>être l&apos;auteur ou l&apos;ayant droit de ces œuvres, ou disposer des autorisations nécessaires ;</li>
        <li>que leur traitement par Flowrima ne porte atteinte aux droits d&apos;aucun tiers.</li>
      </ul>
      <p>
        Cette attestation est horodatée et conservée. Tu garantis l&apos;éditeur contre toute réclamation de tiers liée aux contenus que tu
        importes. Il est interdit d&apos;importer les paroles d&apos;un autre artiste.
      </p>
      <h2>4. Utilisation de tes contenus</h2>
      <p>
        Tes titres sont utilisés uniquement pour te fournir le service (calcul de ton ADN, génération, retouches). Ils ne sont jamais utilisés
        pour entraîner un modèle d&apos;intelligence artificielle sans ton consentement explicite (option désactivée par défaut, révocable à tout
        moment). Nos sous-traitants (dont le fournisseur d&apos;IA) sont liés par un accord de traitement des données qui leur interdit cet usage.
      </p>
      <h2>5. Contenus générés</h2>
      <p>
        Sous réserve du respect des présentes, l&apos;éditeur te cède, à titre gratuit et pour le monde entier, l&apos;ensemble des droits
        qu&apos;il pourrait détenir sur les textes générés pour toi, dans la limite de ce que permet la loi. Tu peux les exploiter librement,
        y compris commercialement.
      </p>
      <p>
        <strong>Important — droit d&apos;auteur et SACEM.</strong> La protection par le droit d&apos;auteur et le dépôt auprès d&apos;une société
        de gestion collective supposent un apport créatif humain. Un texte généré sans intervention peut ne pas être protégé. Nous
        t&apos;encourageons à réécrire, sélectionner et personnaliser les propositions : ton apport fait de ton morceau une œuvre. Flowrima
        indique pour chaque version la part réécrite par toi.
      </p>
      <p>
        Les générations sont réalisées par un modèle probabiliste : des ressemblances fortuites avec des textes existants ne peuvent être
        totalement exclues. Flowrima vérifie automatiquement qu&apos;aucune proposition ne reprend plus de 4 mots consécutifs de tes propres
        titres et refuse de reproduire les paroles d&apos;autres artistes ; il t&apos;appartient néanmoins de vérifier l&apos;originalité avant
        exploitation.
      </p>
      <h2>6. Règles de contenu</h2>
      <p>
        Les thèmes durs, la violence fictive, l&apos;egotrip et le vocabulaire de la rue sont acceptés, comme dans la musique réelle. Sont
        interdits : l&apos;incitation à la haine ou à la violence contre des personnes ou des groupes, le harcèlement, la menace ou la
        diffamation d&apos;une personne réelle, tout contenu sexualisant des mineurs, et toute tentative de contournement des protections du
        service. Les demandes non conformes sont refusées et peuvent être examinées par notre équipe de modération.
      </p>
      <h2>7. Transparence IA</h2>
      <p>
        Les contenus produits par l&apos;IA sont signalés « générés avec l&apos;IA » dans l&apos;interface et les exports. Les contenus audio
        générés (phase ultérieure) seront marqués conformément à l&apos;article 50 du règlement (UE) 2024/1689.
      </p>
      <h2>8. Disponibilité et responsabilité</h2>
      <p>
        Le service est fourni en l&apos;état, avec une obligation de moyens. L&apos;éditeur ne saurait être tenu responsable de l&apos;usage
        fait des contenus générés ni des pertes indirectes. Les quotas et plafonds d&apos;usage raisonnable de chaque offre s&apos;appliquent.
      </p>
      <h2>9. Résiliation et suppression</h2>
      <p>
        Tu peux supprimer ton compte à tout moment depuis la page Compte : tes données sont alors effacées, sous réserve des obligations
        légales de conservation (facturation). L&apos;éditeur peut suspendre un compte en cas de manquement grave aux présentes.
      </p>
      <h2>10. Droit applicable</h2>
      <p>
        Les présentes sont soumises au droit français. En cas de litige, une solution amiable sera recherchée avant toute action ; le
        consommateur peut recourir gratuitement à un médiateur de la consommation [nom et coordonnées du médiateur]. Contact : {COMPANY.email}.
      </p>
    </>
  );
}
