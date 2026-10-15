import Link from "next/link";
import { LogOut, Shield } from "lucide-react";
import { Badge } from "@/components/ui/card";
import { getProfile, isAdmin } from "@/lib/auth";
import { signOut } from "@/lib/actions/auth";
import { m } from "@/i18n";

const PLAN_LABEL = { free: "Découverte", artist: "Artiste", pro: "Pro", label: "Label" } as const;

export async function UserBox({ compact = false }: { compact?: boolean }) {
  const profile = await getProfile();
  if (!profile) return null;
  const admin = await isAdmin();
  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <Badge tone={profile.plan === "free" ? "default" : "accent"}>{PLAN_LABEL[profile.plan]}</Badge>
        <Link href="/app/compte" className="rounded-lg px-2 py-1 text-sm font-medium" aria-label={m.nav.account}>
          {(profile.display_name ?? profile.email ?? "?").slice(0, 1).toUpperCase()}
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2 px-3">
        <p className="truncate text-sm font-medium">{profile.display_name ?? profile.email}</p>
        <Badge tone={profile.plan === "free" ? "default" : "accent"}>{PLAN_LABEL[profile.plan]}</Badge>
      </div>
      {admin && (
        <Link href="/app/admin" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2">
          <Shield className="size-4" aria-hidden /> {m.nav.admin}
        </Link>
      )}
      <form action={signOut}>
        <button type="submit" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2">
          <LogOut className="size-4" aria-hidden /> {m.nav.logout}
        </button>
      </form>
    </div>
  );
}
