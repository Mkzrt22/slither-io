import type { Metadata } from "next";
import Link from "next/link";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Tarifs",
  description: "Découverte gratuit, Artiste à 12,99 €/mois (9,99 € en annuel) avec 7 jours d'essai. Pro et Label bientôt.",
};

const ROWS: Array<[string, string, string, string, string]> = [
  ["Titres analysés", "3", "30", "Illimité", "Illimité"],
  ["Générations complètes / mois", "3", "40", "150", "400"],
  ["Retouches", "20", "Illimitées*", "Illimitées*", "Illimitées*"],
  ["Export PDF fiche studio", "—", "✓", "✓", "✓"],
  ["Crédits prod IA / mois", "—", "5", "25", "80"],
  ["Profils artistes", "1", "1", "1", "5"],
  ["Stems, priorité", "—", "—", "✓", "✓"],
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <h1 className="mb-2 text-4xl font-bold tracking-tight">Tarifs</h1>
      <p className="mb-8 max-w-2xl text-muted">
        Prix TTC. La TVA est calculée automatiquement selon ton pays. Sans engagement : tu résilies en un clic depuis ton compte.
      </p>
      <PricingCards />
      <h2 className="mb-4 mt-14 text-2xl font-semibold">Comparatif</h2>
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="p-3 font-semibold">Fonctionnalité</th>
              <th scope="col" className="p-3 font-semibold">Découverte</th>
              <th scope="col" className="p-3 font-semibold">Artiste</th>
              <th scope="col" className="p-3 font-semibold">Pro</th>
              <th scope="col" className="p-3 font-semibold">Label</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([label, ...cells]) => (
              <tr key={label} className="border-t border-border">
                <th scope="row" className="p-3 font-medium">{label}</th>
                {cells.map((c, i) => (
                  <td key={i} className="p-3 text-muted">{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        * Usage raisonnable : un plafond technique protège le service contre les abus automatisés (300 retouches / mois sur Artiste). Tu
        es prévenu bien avant de l&apos;atteindre.
      </p>
      <Card className="mt-10 space-y-2">
        <h2 className="text-lg font-semibold">Packs de crédits prod</h2>
        <p className="text-sm text-muted">
          Avec le Studio Prod (phase 3), tu pourras acheter des crédits à l&apos;unité pour générer des instrus en plus de ton plan.
        </p>
        <p className="text-sm">
          Une question ? <Link href="/faq" className="text-accent-text underline">Consulte la FAQ</Link>.
        </p>
      </Card>
    </div>
  );
}
