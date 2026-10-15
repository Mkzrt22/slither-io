"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { m } from "@/i18n";
import type { ArtistProfileRow, PlatformLinkRow } from "@/lib/db/types";
import { ArtistProfileForm } from "./artist-profile-form";
import { ImportTracksForm } from "@/components/catalogue/import-tracks-form";
import { AnalyzeButton } from "@/components/dna/analyze-button";

export function OnboardingWizard(props: {
  initialStep: 0 | 1 | 2;
  artist: ArtistProfileRow | null;
  links: PlatformLinkRow[];
  trackCount: number;
  tracksMax: number;
  dnaReady: boolean;
  activeJobId: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(props.initialStep);
  const [trackCount, setTrackCount] = useState(props.trackCount);
  const remaining = props.tracksMax === -1 ? -1 : Math.max(0, props.tracksMax - trackCount);
  const toImport = useCallback(() => {
    setStep(1);
    router.refresh();
  }, [router]);

  return (
    <div className="space-y-6">
      <ol className="flex items-center gap-2" aria-label="Étapes">
        {m.onboarding.steps.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => i <= Math.max(step, props.initialStep) && setStep(i as 0 | 1 | 2)}
              aria-current={step === i ? "step" : undefined}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                i < step ? "border-accent bg-accent text-accent-fg" : i === step ? "border-accent text-accent-text" : "border-border text-muted",
              )}
            >
              {i < step ? <Check className="size-4" aria-hidden /> : i + 1}
            </button>
            <span className={cn("text-sm", step === i ? "font-semibold" : "text-muted")}>{label}</span>
            {i < 2 && <span className="h-px flex-1 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <h2 className="mb-4 text-xl font-semibold">{m.onboarding.profileTitle}</h2>
          <ArtistProfileForm artist={props.artist} links={props.links} onSaved={toImport} />
        </Card>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold">{m.onboarding.importTitle}</h2>
            <p className="text-sm text-muted">
              {m.onboarding.importHelp} Déjà importés : {trackCount}
              {props.tracksMax !== -1 && ` / ${props.tracksMax}`}.
            </p>
          </div>
          <ImportTracksForm
            remaining={remaining}
            submitLabel="Importer"
            onImported={(n) => {
              setTrackCount((c) => c + n);
              router.refresh();
            }}
          />
          <Button variant="outline" className="w-full" disabled={trackCount === 0} onClick={() => setStep(2)}>
            {m.common.next} ({trackCount} titre{trackCount > 1 ? "s" : ""})
          </Button>
        </div>
      )}

      {step === 2 && (
        <Card className="space-y-4">
          <h2 className="text-xl font-semibold">{m.onboarding.analysisTitle}</h2>
          <p className="text-sm text-muted">{m.onboarding.analysisHelp}</p>
          {trackCount < 3 && <p className="rounded-xl bg-warning/10 p-3 text-sm text-warning">{m.dna.tooFew}</p>}
          {props.dnaReady ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild><Link href="/app/adn">Voir mon ADN</Link></Button>
              <Button asChild variant="outline"><Link href="/app/studio">{m.onboarding.finish}</Link></Button>
            </div>
          ) : (
            <AnalyzeButton label={m.dna.analyze} activeJobId={props.activeJobId} />
          )}
        </Card>
      )}
    </div>
  );
}
