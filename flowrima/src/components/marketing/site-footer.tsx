import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { CookieSettingsButton } from "./cookie-settings-button";

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <Logo />
          <p className="text-sm text-muted">Studio d&apos;écriture IA pour artistes indépendants. Hébergé dans l&apos;Union européenne.</p>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Produit</p>
          <ul className="space-y-2 text-sm text-muted">
            <li><Link href="/#fonctionnalites" className="hover:text-foreground">Fonctionnalités</Link></li>
            <li><Link href="/tarifs" className="hover:text-foreground">Tarifs</Link></li>
            <li><Link href="/faq" className="hover:text-foreground">FAQ</Link></li>
            <li><Link href="/blog" className="hover:text-foreground">Blog</Link></li>
          </ul>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Légal</p>
          <ul className="space-y-2 text-sm text-muted">
            <li><Link href="/legal/mentions-legales" className="hover:text-foreground">Mentions légales</Link></li>
            <li><Link href="/legal/cgu" className="hover:text-foreground">CGU</Link></li>
            <li><Link href="/legal/cgv" className="hover:text-foreground">CGV</Link></li>
            <li><Link href="/legal/confidentialite" className="hover:text-foreground">Confidentialité</Link></li>
            <li><Link href="/legal/cookies" className="hover:text-foreground">Cookies</Link></li>
            <li><CookieSettingsButton /></li>
          </ul>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold">Transparence IA</p>
          <p className="text-sm text-muted">
            Les textes proposés sont générés avec l&apos;IA puis retravaillés par l&apos;artiste. Tes titres ne servent jamais à entraîner un
            modèle sans ton accord explicite.
          </p>
        </div>
      </div>
      <p className="border-t border-border py-4 text-center text-xs text-muted">© 2026 Flowrima — tous droits réservés.</p>
    </footer>
  );
}
