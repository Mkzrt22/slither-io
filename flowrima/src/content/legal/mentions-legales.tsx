import { COMPANY, DraftNotice, LEGAL_UPDATED } from "./common";

export const title = "Mentions légales";

export default function MentionsLegales() {
  return (
    <>
      <DraftNotice />
      <p>Dernière mise à jour : {LEGAL_UPDATED}</p>
      <h2>Éditeur du site</h2>
      <p>
        Le site Flowrima est édité par {COMPANY.name}, {COMPANY.form}, dont le siège est situé {COMPANY.address}, immatriculée au{" "}
        {COMPANY.rcs}, SIRET {COMPANY.siret}, TVA {COMPANY.vat}.
      </p>
      <p>Directeur de la publication : {COMPANY.director}. Contact : {COMPANY.email}.</p>
      <h2>Hébergement</h2>
      <p>
        Application : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis (fonctions exécutées dans la région de Paris).
        Base de données, authentification et fichiers : Supabase Inc., infrastructure située dans l&apos;Union européenne.
      </p>
      <h2>Propriété intellectuelle</h2>
      <p>
        La marque Flowrima, le site et ses contenus (hors contenus des utilisateurs) sont la propriété de l&apos;éditeur. Les textes, titres
        et fichiers importés par les utilisateurs restent leur propriété.
      </p>
      <h2>Intelligence artificielle</h2>
      <p>
        Flowrima utilise des modèles d&apos;intelligence artificielle fournis par Anthropic pour l&apos;analyse et la génération de textes. Les
        contenus générés sont signalés comme tels, conformément au règlement européen sur l&apos;IA.
      </p>
      <h2>Signalement</h2>
      <p>Pour signaler un contenu illicite : {COMPANY.email}, ou via le bouton « Signaler » dans le studio.</p>
    </>
  );
}
