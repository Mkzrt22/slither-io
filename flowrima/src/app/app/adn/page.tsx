import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PenLine } from "lucide-react";
import { PageHeader, PageSkeleton } from "@/components/app/page-header";
import { AnalyzeButton } from "@/components/dna/analyze-button";
import { ReliabilityMeter, StatTile, ThemeBars, ThemesRadar, WordCloud } from "@/components/dna/charts";
import { TimelineChart } from "@/components/dna/timeline-chart";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardTitle, EmptyState } from "@/components/ui/card";
import { getActiveArtist, requireUser } from "@/lib/auth";
import { getActiveDnaJob, getLatestDna, getTracks } from "@/lib/data/queries";
import { reliabilityLabel } from "@/lib/text/analyze";
import { SECTION_LABELS, type SectionType } from "@/lib/text/parse";
import { formatDate } from "@/lib/utils";
import { m } from "@/i18n";

export const metadata: Metadata = { title: "Mon ADN" };

const pct = (x: number) => `${Math.round(x * 100)} %`;

async function DnaContent() {
  await requireUser("/app/adn");
  const artist = await getActiveArtist();
  if (!artist) {
    return <EmptyState title={m.dna.none} action={<Button asChild><Link href="/app/onboarding">Configurer</Link></Button>} />;
  }
  const [dna, job, tracks] = await Promise.all([getLatestDna(artist.id), getActiveDnaJob(), getTracks(artist.id)]);
  const withLyrics = tracks.filter((t) => t.lyrics).length;
  const stale = dna && tracks.some((t) => new Date(t.updated_at) > new Date(dna.created_at));

  if (!dna) {
    return (
      <Card className="space-y-4">
        <CardTitle>{m.dna.none}</CardTitle>
        <p className="text-sm text-muted">{withLyrics ? `${withLyrics} titre(s) prêts à être analysés.` : m.dna.noneHelp}</p>
        {withLyrics > 0 && withLyrics < 3 && <p className="rounded-xl bg-warning/10 p-3 text-sm text-warning">{m.dna.tooFew}</p>}
        {withLyrics > 0 ? (
          <AnalyzeButton label={m.dna.analyze} activeJobId={job?.id} />
        ) : (
          <Button asChild><Link href="/app/catalogue/nouveau">{m.catalogue.add}</Link></Button>
        )}
      </Card>
    );
  }

  const { llm, metrics } = dna.dna_json!;
  const bpms = tracks.map((t) => t.bpm_manual).filter((b): b is number => b !== null);
  const avgBpm = bpms.length ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null;
  const timeline = metrics.timeline.filter((t) => t.releaseDate);

  return (
    <div className="space-y-6">
      <Card className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{m.dna.version} {dna.version}</Badge>
            <span className="text-sm text-muted">{formatDate(dna.created_at)} · {dna.track_count} titres</span>
            {stale && <Badge tone="warning">Catalogue modifié depuis</Badge>}
          </div>
          <p className="max-w-2xl text-base">{llm.summary}</p>
          <ReliabilityMeter score={dna.reliability_score ?? 0} label={m.dna.reliabilityLabels[reliabilityLabel(dna.reliability_score ?? 0)]} />
        </div>
        <div className="space-y-2">
          <Button asChild><Link href="/app/studio"><PenLine aria-hidden /> Écrire avec cet ADN</Link></Button>
          <AnalyzeButton label={m.dna.reanalyze} activeJobId={job?.id} />
        </div>
      </Card>

      <section aria-labelledby="sig">
        <h2 id="sig" className="mb-3 text-xl font-semibold">{m.dna.signature}</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {llm.signature_points.map((p, i) => (
            <li key={i} className="rounded-2xl border border-border bg-surface p-4">
              <span className="mb-2 inline-flex size-7 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-fg">{i + 1}</span>
              <p className="text-sm">{p}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle className="mb-4">{m.dna.themes}</CardTitle>
          <ThemesRadar themes={llm.themes} />
        </Card>
        <Card>
          <CardTitle className="mb-2">{m.dna.words}</CardTitle>
          <WordCloud signature={metrics.vocabulary.signatureWords} frequent={metrics.vocabulary.topWords} />
          <p className="mt-2 text-xs text-muted">En couleur : tes mots signatures (fréquents chez toi, rares ailleurs). Taille = fréquence.</p>
        </Card>
      </div>

      <section aria-labelledby="flow">
        <h2 id="flow" className="mb-3 text-xl font-semibold">{m.dna.rhymes} et {m.dna.flow}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Syllabes par mesure" value={`${metrics.syllablesPerBar.avg}`} hint={`habituellement ${metrics.syllablesPerBar.p25} à ${metrics.syllablesPerBar.p75}`} />
          <StatTile label="Densité de rimes" value={pct(metrics.rhymes.density)} hint="syllabes qui riment" />
          <StatTile label="Rimes multisyllabiques" value={pct(metrics.rhymes.multiRate)} hint="des lignes qui riment" />
          <StatTile label="Rimes internes" value={`${metrics.rhymes.internalPerLine}`} hint="par ligne" />
          <StatTile label="Lignes qui riment" value={pct(metrics.rhymes.rhymedLineRate)} />
          <StatTile label="Richesse du vocabulaire" value={pct(metrics.vocabulary.richness)} hint="mots différents / 100 mots" />
          <StatTile label="Part d'anglais" value={pct(metrics.vocabulary.englishShare)} />
          <StatTile label="BPM favori" value={avgBpm ? `${avgBpm}` : "—"} hint={avgBpm ? `moyenne de ${bpms.length} titre(s) renseigné(s)` : "renseigne le BPM de tes titres (analyse audio en phase 2)"} />
        </div>
        <Card className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">Schémas dominants</p>
            <ThemeBars themes={metrics.rhymes.dominantPatterns.map((p) => ({ name: p.label, weight: p.share }))} />
          </div>
          <div className="space-y-2 text-sm">
            <p><span className="font-medium">Style de rimes : </span>{llm.rhyme_style.notes}</p>
            <p><span className="font-medium">Flow : </span>{llm.flow.description}</p>
          </div>
        </Card>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle className="mb-3">{m.dna.structure}</CardTitle>
          <ol className="flex flex-wrap gap-2">
            {metrics.structure.typicalSequence.map((s, i) => (
              <li key={i} className="rounded-full bg-surface-2 px-3 py-1 text-sm">
                {SECTION_LABELS[s as SectionType] ?? s}
                {s === "couplet" && ` · ${metrics.structure.avgCoupletBars} mes.`}
                {s === "refrain" && ` · ${metrics.structure.avgRefrainBars} mes.`}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-muted">
            Répétition : {pct(metrics.structure.refrainRepetitionRate)} des lignes sont répétées. {llm.typical_structure.notes}
          </p>
        </Card>
        <Card>
          <CardTitle className="mb-3">{m.dna.devices}</CardTitle>
          <ul className="space-y-2 text-sm">
            {llm.devices.map((d) => (
              <li key={d.name}>
                <span className="font-medium capitalize">{d.name}</span>{" "}
                <Badge tone={d.frequency === "signature" ? "accent" : "default"}>{d.frequency}</Badge>
                {d.examples[0] && <span className="ml-1 text-muted">« {d.examples[0]} »</span>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-2 text-sm">
          <CardTitle className="mb-1">{m.dna.register}</CardTitle>
          <p><span className="font-medium">Registre : </span>{llm.register.level} — {llm.register.description}</p>
          <p><span className="font-medium">Point de vue : </span>{llm.point_of_view.dominant.replace("_", "/")} — {llm.point_of_view.description}</p>
          <p><span className="font-medium">Langues : </span>{llm.languages.map((l) => `${l.code} ${pct(l.share)}`).join(" · ")}</p>
          {(llm.slang.argot.length > 0 || llm.slang.verlan.length > 0) && (
            <p><span className="font-medium">Argot / verlan : </span>{[...llm.slang.argot, ...llm.slang.verlan].slice(0, 10).join(", ")}</p>
          )}
        </Card>
        <Card className="space-y-2 text-sm">
          <CardTitle className="mb-1">Émotions</CardTitle>
          <ThemeBars themes={llm.emotions.map((e) => ({ name: e.name, weight: e.weight }))} />
        </Card>
        <Card className="space-y-2 text-sm">
          <CardTitle className="mb-1">{m.dna.adlibs}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {[...new Set([...llm.gimmicks, ...llm.adlibs, ...metrics.adlibs.map(([a]) => a)])].slice(0, 14).map((g) => (
              <span key={g} className="rounded-full bg-surface-2 px-3 py-1">{g}</span>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle className="mb-1">{m.dna.evolution}</CardTitle>
        <p className="mb-4 text-sm text-muted">{llm.evolution.summary}</p>
        <div className="grid gap-6 sm:grid-cols-2">
          <TimelineChart
            title="Syllabes par mesure"
            points={timeline.map((t) => ({ label: t.title, date: t.releaseDate, value: t.syllablesAvg }))}
            unit="decimal"
          />
          <TimelineChart
            title="Densité de rimes"
            points={timeline.map((t) => ({ label: t.title, date: t.releaseDate, value: t.density * 100 }))}
            unit="percent"
          />
        </div>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-accent-text">Voir les données</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left">
              <thead className="text-muted">
                <tr><th className="py-1 font-medium">Titre</th><th className="font-medium">Sortie</th><th className="font-medium">Syll./mesure</th><th className="font-medium">Densité</th></tr>
              </thead>
              <tbody>
                {metrics.timeline.map((t) => (
                  <tr key={t.title} className="border-t border-border">
                    <td className="py-1">{t.title}</td>
                    <td className="tabular-nums">{t.releaseDate ?? "—"}</td>
                    <td className="tabular-nums">{t.syllablesAvg}</td>
                    <td className="tabular-nums">{pct(t.density)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <p><span className="font-medium">Avant : </span>{llm.evolution.early_traits.join(", ") || "—"}</p>
          <p><span className="font-medium">Récemment : </span>{llm.evolution.recent_traits.join(", ") || "—"}</p>
        </div>
      </Card>

      <Card>
        <CardTitle className="mb-3">Sujets que tu n&apos;as pas encore abordés</CardTitle>
        <ul className="flex flex-wrap gap-2">
          {llm.unexplored_themes.map((t) => (
            <li key={t}>
              <Link href={`/app/studio?sujet=${encodeURIComponent(t)}`} className="inline-flex rounded-full border border-border px-3 py-1.5 text-sm hover:border-accent">
                {t}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default function DnaPage() {
  return (
    <>
      <PageHeader title={m.dna.title} description="Calculé par le code (syllabes, rimes, structure) et interprété par l'IA." />
      <Suspense fallback={<PageSkeleton />}>
        <DnaContent />
      </Suspense>
    </>
  );
}
