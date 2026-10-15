"use client";
import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n";

const LINKS = [
  { href: "/#fonctionnalites", label: "Fonctionnalités" },
  { href: "/tarifs", label: m.nav.pricing },
  { href: "/faq", label: m.nav.faq },
  { href: "/blog", label: m.nav.blog },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Logo />
        <nav aria-label="Navigation principale" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link href="/connexion" className="hidden rounded-lg px-3 py-2 text-sm font-medium sm:inline-block">
            {m.nav.login}
          </Link>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/inscription">{m.nav.signup}</Link>
          </Button>
          <button
            type="button"
            className="rounded-lg p-2 md:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={m.nav.menu}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
      </div>
      {open && (
        <nav id="mobile-menu" aria-label="Navigation mobile" className="border-t border-border px-4 pb-4 md:hidden">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block py-3 text-base">
              {l.label}
            </Link>
          ))}
          <Link href="/connexion" className="block py-3 text-base" onClick={() => setOpen(false)}>
            {m.nav.login}
          </Link>
          <Button asChild className="mt-2 w-full">
            <Link href="/inscription">{m.nav.signup}</Link>
          </Button>
        </nav>
      )}
    </header>
  );
}
