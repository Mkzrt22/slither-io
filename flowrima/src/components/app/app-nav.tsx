"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Fingerprint, FolderOpen, Home, Music4, PenLine, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { m } from "@/i18n";

const ITEMS = [
  { href: "/app", label: m.nav.dashboard, short: "Accueil", icon: Home, exact: true },
  { href: "/app/catalogue", label: m.nav.catalogue, short: "Catalogue", icon: BookOpen },
  { href: "/app/adn", label: m.nav.dna, short: "ADN", icon: Fingerprint },
  { href: "/app/studio", label: m.nav.studio, short: "Écrire", icon: PenLine, primary: true },
  { href: "/app/projets", label: m.nav.projects, short: "Projets", icon: FolderOpen },
  { href: "/app/prod", label: m.nav.prod, short: "Prod", icon: Music4 },
  { href: "/app/compte", label: m.nav.account, short: "Compte", icon: User },
];

function useActive() {
  const pathname = usePathname();
  return (href: string, exact?: boolean) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
}

export function SideNav() {
  const isActive = useActive();
  return (
    <nav aria-label="Navigation de l'application" className="flex flex-col gap-1">
      {ITEMS.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={isActive(it.href, it.exact) ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground",
            isActive(it.href, it.exact) && "bg-surface-2 text-foreground",
          )}
        >
          <it.icon className={cn("size-5", isActive(it.href, it.exact) && "text-accent-text")} aria-hidden />
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

const MOBILE = ["/app", "/app/catalogue", "/app/studio", "/app/projets", "/app/adn"];

export function BottomNav() {
  const isActive = useActive();
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid grid-cols-5">
        {ITEMS.filter((i) => MOBILE.includes(i.href)).map((it) => {
          const active = isActive(it.href, it.exact);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-foreground" : "text-muted")}
              >
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full",
                    it.primary ? "bg-accent text-accent-fg" : active ? "bg-surface-2" : "",
                  )}
                >
                  <it.icon className="size-5" aria-hidden />
                </span>
                {it.short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
