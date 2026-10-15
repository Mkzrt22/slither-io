import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { getPublicPlans } from "@/lib/billing/public-plans";
import { formatEUR } from "@/lib/utils";

export async function PricingCards({ compact = false }: { compact?: boolean }) {
  const plans = await getPublicPlans();
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {plans.map((p) => (
        <Card key={p.id} className={p.highlight ? "border-accent ring-1 ring-accent" : undefined}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-lg font-semibold">{p.name}</h3>
            {p.highlight && <Badge tone="accent">Populaire</Badge>}
            {!p.availableNow && <Badge>Phase 2</Badge>}
          </div>
          <p className="text-3xl font-bold">
            {p.priceMonthlyCents === 0 ? "0 €" : formatEUR(p.priceMonthlyCents)}
            <span className="text-sm font-normal text-muted"> /mois</span>
          </p>
          {p.priceYearlyMonthlyCents && (
            <p className="text-sm text-accent-text">ou {formatEUR(p.priceYearlyMonthlyCents)} /mois en annuel</p>
          )}
          <p className="mt-2 text-sm text-muted">{p.description}</p>
          {!compact || p.highlight ? (
            <ul className="mt-4 space-y-2 text-sm">
              {p.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-4 space-y-2 text-sm">
              {p.features.slice(0, 3).map((f) => (
                <li key={f} className="flex gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          )}
          <Button asChild className="mt-5 w-full" variant={p.highlight ? "default" : "outline"}>
            {p.availableNow ? (
              <Link href={p.id === "free" ? "/inscription" : "/inscription?plan=artist"}>
                {p.id === "free" ? "Commencer gratuitement" : "Essai gratuit 7 jours"}
              </Link>
            ) : (
              <Link href="/#liste-attente">Être prévenu</Link>
            )}
          </Button>
        </Card>
      ))}
    </div>
  );
}
