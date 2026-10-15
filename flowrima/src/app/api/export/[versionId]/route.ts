import type { NextRequest } from "next/server";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { consumeQuota } from "@/lib/services/usage";
import { renderStudioSheet, renderText, type StudioSheet } from "@/lib/export/pdf";
import type { LyricVersionRow, ProjectRow } from "@/lib/db/types";

/** TXT (all plans) and PDF « fiche studio » (paid plans) exports of a version. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ versionId: string }> }) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthorized", "Non connecté");
  const { versionId } = await ctx.params;
  const format = request.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "txt";
  const supabase = await createClient();
  const { data: v } = await supabase.from("lyric_versions").select("*").eq("id", versionId).maybeSingle();
  if (!v) return jsonError(404, "not_found", "Version introuvable");
  const version = v as LyricVersionRow;
  const { data: p } = await supabase.from("projects").select("*, artist_profiles(stage_name)").eq("id", version.project_id).single();
  const project = p as ProjectRow & { artist_profiles: { stage_name: string } | null };

  const sheet: StudioSheet = {
    title: version.title || project.title,
    artist: project.artist_profiles?.stage_name ?? "",
    bpm: project.bpm,
    musicalKey: project.musical_key,
    content: version.content_json,
    aiGenerated: version.is_ai_generated,
    humanEditRatio: Number(version.human_edit_ratio),
    date: new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" }).format(new Date()),
  };
  const filename = (sheet.title || "paroles").replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "paroles";

  if (format === "txt") {
    return new Response(renderText(sheet), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${encodeURIComponent(filename)}.txt"`,
      },
    });
  }
  const quota = await consumeQuota(user.id, "export_pdf", version.id);
  if (!quota.allowed) {
    return jsonError(402, "quota_exceeded", "L'export PDF « fiche studio » est inclus dans le plan Artiste.");
  }
  const bytes = await renderStudioSheet(sheet);
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${encodeURIComponent(filename)}-fiche-studio.pdf"`,
    },
  });
}
