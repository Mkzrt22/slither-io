import type { Metadata } from "next";
import { Suspense } from "react";
import { Music4, Store } from "lucide-react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { Badge, Card, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { getLatestDna, getTracks } from "@/lib/data/queries";
import { buildProdPrompt } from "@/lib/ai/prompts/prod";

export const metadata: Metadata = { title: "Studio Prod" };

async function ProdPreview() {
  await requireUser("/app/prod");
  const artist = await getActiveArtist();
  const [dna, tracks] = artist ? await Promise.all([getLatestDna(artist.id), getTracks(artist.id)]) : [null, []];
  const bpms = tracks.map((t) => t.bpm_manual).filter((b): b is number => b !== null);
  const prompt = buildProdPrompt(
    {
      bpm: bpms.length ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null,
      subgenre: artist?.genres[0] ?? null,
      moods: dna?.dna_json?.llm.emotions.slice(0, 2).map((e) => e.name) ?? [],
    },
    {},
  );
  return (
    <Tabs defaultValue="propose">
      <TabsList>
        <TabsTrigger value="propose"><Store className="mr-1 inline size-4" aria-hidden />Proposer</TabsTrigger>
        <TabsTrigger value="generate"><Music4 className="mr-1 inline size-4" aria-hidden />Générer</TabsTrigger>
      </TabsList>
      <TabsContent value="propose" className="mt-4">
        <Card className="space-y-2">
          <div className="flex items-center gap-2"><CardTitle>Catalogue de prods sous licence</CardTitle><Badge>Phase 2</Badge></div>
          <p className="text-sm text-muted">
            Des instrus de beatmakers partenaires, classées selon ton univers sonore (BPM, tonalité, ambiance, empreinte audio), à écouter en
            extrait tatoué et à licencier (simple ou exclusive) avec contrat PDF automatique.
          </p>
        </Card>
      </TabsContent>
      <TabsContent value="generate" className="mt-4">
        <Card className="space-y-3">
          <div className="flex items-center gap-2"><CardTitle>Prod générée par IA</CardTitle><Badge>Phase 3</Badge></div>
          <p className="text-sm text-muted">
            Le prompt musical sera construit automatiquement depuis ton ADN audio, puis modifiable. Uniquement via des fournisseurs dont la
            licence autorise l&apos;usage commercial. Aperçu du prompt avec tes données actuelles :
          </p>
          <pre className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-sm">{prompt}</pre>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

export default function ProdPage() {
  return (
    <>
      <PageHeader title="Studio Prod" description="Trouve ou génère l'instru qui colle à ton univers." />
      <Suspense fallback={<PageSkeleton />}>
        <ProdPreview />
      </Suspense>
    </>
  );
}
