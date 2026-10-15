import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Espace beatmaker" };

export default function BeatmakerPage() {
  return (
    <>
      <PageHeader title="Espace beatmaker" description="Phase 2 : vends tes prods aux artistes de Flowrima." />
      <Card className="space-y-2 text-sm text-muted">
        <p>Inscription vendeur avec vérification d&apos;identité (Stripe Connect), dépôt des prods et extraits tatoués, prix des licences simple et exclusive, commission de la plateforme de 20 à 30 %, validation par l&apos;équipe avant publication.</p>
        <p>Le modèle de données (producers, beats, beat_licenses) et ses règles d&apos;accès sont déjà en place.</p>
      </Card>
    </>
  );
}
