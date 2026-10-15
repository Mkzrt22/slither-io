export const LEGAL_UPDATED = "15 octobre 2026";

/** Placeholders to replace before going live (company details). */
export const COMPANY = {
  name: "[Raison sociale]",
  form: "[forme juridique, ex. SAS au capital de 1 000 €]",
  address: "[adresse du siège]",
  rcs: "[RCS Ville n°]",
  siret: "[SIRET]",
  vat: "[n° TVA intracommunautaire]",
  director: "[nom du directeur de la publication]",
  email: "[contact@flowrima.app]",
  dpo: "[dpo@flowrima.app]",
};

export function DraftNotice() {
  return (
    <p className="mb-6 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
      Document type rédigé pour le lancement : il doit être relu et validé par un avocat avant la mise en production. Les éléments entre
      crochets sont à compléter.
    </p>
  );
}
