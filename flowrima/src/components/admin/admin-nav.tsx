import Link from "next/link";

const LINKS = [
  { href: "/app/admin", label: "Vue d'ensemble" },
  { href: "/app/admin/moderation", label: "Modération" },
  { href: "/app/admin/utilisateurs", label: "Utilisateurs" },
  { href: "/app/admin/plans", label: "Plans et quotas" },
];

export function AdminNav() {
  return (
    <nav aria-label="Administration" className="mb-6 flex flex-wrap gap-2">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className="rounded-full border border-border px-3 py-1.5 text-sm hover:border-accent">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
