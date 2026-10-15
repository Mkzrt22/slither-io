"use client";
import { useActionState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveArtistProfile, type ActionState } from "@/lib/actions/artist";
import { GENRES } from "@/lib/text/flow";
import { m } from "@/i18n";
import type { ArtistProfileRow, PlatformLinkRow } from "@/lib/db/types";

const LANGS = [
  { id: "fr", label: "Français" },
  { id: "en", label: "Anglais" },
  { id: "ar", label: "Arabe" },
  { id: "cr", label: "Créole" },
  { id: "es", label: "Espagnol" },
  { id: "pt", label: "Portugais" },
  { id: "wo", label: "Wolof" },
  { id: "ln", label: "Lingala" },
];
const LINKS = [
  { id: "spotify", label: "Spotify", ph: "https://open.spotify.com/artist/…" },
  { id: "deezer", label: "Deezer", ph: "https://www.deezer.com/artist/…" },
  { id: "youtube", label: "YouTube", ph: "https://www.youtube.com/@…" },
  { id: "instagram", label: "Instagram", ph: "https://instagram.com/…" },
  { id: "soundcloud", label: "SoundCloud", ph: "https://soundcloud.com/…" },
] as const;

function Chip({ name, value, label, defaultChecked }: { name: string; value: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="cursor-pointer">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="peer sr-only" />
      <span className="inline-flex h-10 items-center rounded-full border border-border px-4 text-sm peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-fg peer-focus-visible:outline-2 peer-focus-visible:outline-ring">
        {label}
      </span>
    </label>
  );
}

export function ArtistProfileForm({
  artist,
  links,
  onSaved,
  submitLabel = m.common.next,
}: {
  artist: ArtistProfileRow | null;
  links: PlatformLinkRow[];
  onSaved?: () => void;
  submitLabel?: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveArtistProfile, null);
  useEffect(() => {
    if (state?.ok) onSaved?.();
  }, [state, onSaved]);
  const linkOf = (p: string) => links.find((l) => l.platform === p)?.url ?? "";
  return (
    <form action={action} className="space-y-5">
      <div>
        <Label htmlFor="stageName">{m.onboarding.stageName}</Label>
        <Input id="stageName" name="stageName" required maxLength={80} defaultValue={artist?.stage_name ?? ""} autoComplete="nickname" />
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{m.onboarding.genres}</legend>
        <div className="flex flex-wrap gap-2">
          {GENRES.map((g) => (
            <Chip key={g.id} name="genres" value={g.id} label={g.label} defaultChecked={artist?.genres.includes(g.id)} />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{m.onboarding.languages}</legend>
        <div className="flex flex-wrap gap-2">
          {LANGS.map((l) => (
            <Chip key={l.id} name="languages" value={l.id} label={l.label} defaultChecked={(artist?.languages ?? ["fr"]).includes(l.id)} />
          ))}
        </div>
      </fieldset>
      <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-3">
        <span className="text-sm">Contenu explicite par défaut</span>
        <Switch name="explicit" defaultChecked={artist?.explicit_default ?? false} aria-label="Contenu explicite par défaut" />
      </label>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium">{m.onboarding.links}</legend>
        {LINKS.map((l) => (
          <div key={l.id}>
            <Label htmlFor={`link_${l.id}`} className="text-xs text-muted">{l.label}</Label>
            <Input id={`link_${l.id}`} name={`link_${l.id}`} type="url" inputMode="url" placeholder={l.ph} defaultValue={linkOf(l.id)} />
          </div>
        ))}
      </fieldset>
      <FieldError>{state && !state.ok ? state.message : null}</FieldError>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? m.common.saving : submitLabel}
      </Button>
    </form>
  );
}
