import Link from "next/link";
import { AudioLines, Fingerprint, PenLine, ShieldCheck, Sparkles, Repeat2, FileText, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LyricsView } from "@/components/lyrics/lyrics-view";
import { WaitlistForm } from "@/components/marketing/waitlist-form";
import { PricingCards } from "@/components/marketing/pricing-cards";

// Original demo lyrics (written for the landing page).
const DEMO = [
  {
    label: "Couplet 1",
    type: "couplet",
    flow: { pace: "moyen", notes: "posé sur le temps, respiration au milieu" },
    lines: [
      "J'rappe la nuit / sous les néons de la ville",
      "Les yeux rougis, j'avance sur un fil (yeah)",
      "Mon cœur est froid comme le bitume en hiver",
      "J'ai grandi vite, j'ai pas connu la lumière",
    ],
  },
  {
    label: "Refrain",
    type: "refrain",
    flow: { pace: "lent", notes: "chanté, voix doublée" },
    lines: ["Encore une nuit (encore)", "Encore un cri", "Je compte les années", "J'ai peur de finir damné"],
  },
];

const FEATURES = [
  {
    icon: Fingerprint,
    title: "Ton ADN artistique",
    text: "Thèmes, vocabulaire, rimes, flow, structure : Flowrima analyse tes titres et résume ta signature en 5 points.",
  },
  {
    icon: PenLine,
    title: "3 propositions, 3 angles",
    text: "A fidèle à ton style, B évolution naturelle, C prise de risque. Des paroles complètes, balisées, prêtes à enregistrer.",
  },
  {
    icon: AudioLines,
    title: "Un éditeur pensé pour le flow",
    text: "Syllabes en marge, rimes colorées par famille, grille de mesures calée sur le BPM, respirations et ad-libs.",
  },
  {
    icon: Repeat2,
    title: "Retouches en un geste",
    text: "Plus punchy, plus sombre, rimes plus riches, plus simple à chanter, plus de double sens : ligne par ligne ou partie entière.",
  },
  {
    icon: ShieldCheck,
    title: "Jamais de recyclage",
    text: "Aucune suite de plus de 4 mots reprise de tes anciens titres, aucune parole copiée d'un autre artiste. Vérifié automatiquement.",
  },
  {
    icon: FileText,
    title: "Fiche studio",
    text: "Export PDF avec paroles, BPM, tonalité et structure minutée. Partage par lien privé avec ton beatmaker.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-10 sm:pt-16 lg:grid-cols-2">
        <div className="space-y-6 animate-fade-in">
          <p className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted">
            <Sparkles className="size-3.5 text-accent-text" /> Rap · Drill · R&amp;B · Pop urbaine · Afro · Variété
          </p>
          <h1 className="text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Des paroles qui sonnent <span className="text-accent-text">comme toi</span>, pas comme une IA.
          </h1>
          <p className="max-w-xl text-lg text-muted">
            Importe tes titres, Flowrima apprend ton ADN artistique et t&apos;écrit des paroles inédites, prêtes à enregistrer. Tu gardes la
            main sur chaque mot.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/inscription">Essayer gratuitement</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#liste-attente">Rejoindre la liste d&apos;attente</Link>
            </Button>
          </div>
          <p className="text-sm text-muted">3 générations offertes · sans carte bancaire · hébergé dans l&apos;UE</p>
        </div>
        <Card className="relative overflow-hidden p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Proposition A — fidèle</p>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">92 BPM · cible 9–12 syll.</span>
          </div>
          <LyricsView sections={DEMO} target={{ min: 9, max: 12 }} />
          <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
            Syllabes en marge · rimes colorées par famille (lettre à droite) · « / » = respiration · ad-libs en italique
          </p>
        </Card>
      </section>

      {/* How it works */}
      <section className="border-y border-border bg-surface/50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:grid-cols-3">
          {[
            ["1", "Importe tes titres", "Colle tes paroles ou envoie un fichier, ajoute tes liens Spotify, Deezer, YouTube."],
            ["2", "Découvre ton ADN", "Syllabes par mesure, schémas de rimes, thèmes, mots signatures, évolution de ton style."],
            ["3", "Écris avec ton IA", "Choisis un sujet, une ambiance et une structure : 3 propositions en direct, à retoucher ligne par ligne."],
          ].map(([n, title, text]) => (
            <div key={n} className="space-y-2">
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-accent font-bold text-accent-fg">{n}</span>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="text-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="fonctionnalites" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
        <h2 className="mb-2 text-3xl font-bold tracking-tight">Tout ce qu&apos;il faut pour sortir plus souvent</h2>
        <p className="mb-8 max-w-2xl text-muted">
          Pensé pour écrire sur ton téléphone, entre deux sessions studio. Installable comme une appli.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card key={f.title} className="space-y-2">
              <f.icon className="size-6 text-accent-text" aria-hidden />
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-muted">{f.text}</p>
            </Card>
          ))}
        </div>
        <Card className="mt-4 flex flex-col gap-3 border-dashed sm:flex-row sm:items-center">
          <AudioLines className="size-6 shrink-0 text-accent-text" aria-hidden />
          <p className="text-sm text-muted">
            <strong className="text-foreground">Bientôt : Studio Prod.</strong> Des instrus sous licence classées selon ton univers sonore, ou
            générées dans le style de tes titres, avec une grille de mesures calée sur tes paroles.
          </p>
        </Card>
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <Card className="grid gap-6 p-6 sm:grid-cols-3">
          <div className="space-y-1">
            <Lock className="size-5 text-accent-text" aria-hidden />
            <p className="font-semibold">Tes textes restent à toi</p>
            <p className="text-sm text-muted">Jamais utilisés pour entraîner un modèle sans ton accord explicite. Export et suppression en un clic.</p>
          </div>
          <div className="space-y-1">
            <ShieldCheck className="size-5 text-accent-text" aria-hidden />
            <p className="font-semibold">Tes droits d&apos;abord</p>
            <p className="text-sm text-muted">Les textes générés te sont cédés. Réécris-les et personnalise-les : c&apos;est ce qui protège ton œuvre.</p>
          </div>
          <div className="space-y-1">
            <Sparkles className="size-5 text-accent-text" aria-hidden />
            <p className="font-semibold">Transparence IA</p>
            <p className="text-sm text-muted">Chaque proposition est signalée « générée avec l&apos;IA », conformément à l&apos;AI Act européen.</p>
          </div>
        </Card>
      </section>

      {/* Pricing */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h2 className="mb-6 text-3xl font-bold tracking-tight">Tarifs simples</h2>
        <PricingCards compact />
      </section>

      {/* Waitlist (phase 0) */}
      <section id="liste-attente" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-8">
        <Card className="p-6 sm:p-8">
          <h2 className="mb-2 text-2xl font-bold tracking-tight">Rejoins la liste d&apos;attente</h2>
          <p className="mb-6 text-muted">
            On ouvre l&apos;accès par vagues aux artistes indépendants. Laisse ton e-mail : les premiers inscrits passent en priorité.
          </p>
          <WaitlistForm />
        </Card>
      </section>
    </>
  );
}
