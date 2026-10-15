import type { Metadata } from "next";
import { FAQ } from "@/content/faq";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Droits d'auteur, SACEM, confidentialité, import de paroles, essai gratuit : toutes les réponses sur Flowrima.",
};

export default function FaqPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-8 text-4xl font-bold tracking-tight">Questions fréquentes</h1>
      <div className="space-y-3">
        {FAQ.map((f) => (
          <details key={f.q} className="group rounded-2xl border border-border bg-surface p-4 open:pb-5">
            <summary className="cursor-pointer list-none text-base font-semibold marker:content-none">
              <span className="flex items-start justify-between gap-4">
                {f.q}
                <span aria-hidden className="text-accent-text transition-transform group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className="mt-3 text-muted">{f.a}</p>
          </details>
        ))}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </div>
  );
}
