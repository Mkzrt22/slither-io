"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { updateTrack, type ImportState } from "@/lib/actions/tracks";
import type { TrackRow } from "@/lib/db/types";
import { m } from "@/i18n";

export function TrackEditForm({ track }: { track: TrackRow }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(updateTrack, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={track.id} />
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_8rem]">
        <div>
          <Label htmlFor="title">{m.catalogue.trackTitle}</Label>
          <Input id="title" name="title" defaultValue={track.title} required maxLength={200} />
        </div>
        <div>
          <Label htmlFor="releaseDate">{m.catalogue.releaseDate}</Label>
          <Input id="releaseDate" name="releaseDate" type="date" defaultValue={track.release_date ?? ""} />
        </div>
        <div>
          <Label htmlFor="bpm">BPM</Label>
          <Input id="bpm" name="bpm" type="number" min={40} max={250} defaultValue={track.bpm_manual ?? ""} />
        </div>
      </div>
      <div>
        <Label htmlFor="lyrics">{m.catalogue.lyrics}</Label>
        <Textarea id="lyrics" name="lyrics" rows={14} className="lyrics" defaultValue={track.lyrics ?? ""} required />
      </div>
      <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-3">
        <span className="text-sm">{m.catalogue.explicit}</span>
        <Switch name="explicit" defaultChecked={track.is_explicit} aria-label={m.catalogue.explicit} />
      </label>
      {state?.ok ? <p role="status" className="text-sm text-success">{state.message}</p> : <FieldError>{state?.message}</FieldError>}
      <Button type="submit" disabled={pending}>{pending ? m.common.saving : m.common.save}</Button>
    </form>
  );
}
