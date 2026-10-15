import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-6xl font-bold text-accent-text">404</p>
      <h1 className="text-2xl font-semibold">Page introuvable</h1>
      <p className="text-muted">Ce lien n&apos;existe pas ou plus.</p>
      <Button asChild><Link href="/">Retour à l&apos;accueil</Link></Button>
    </main>
  );
}
