import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";

/** Job status (polling fallback when Realtime is unavailable). RLS restricts to own jobs. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthorized", "Non connecté");
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase.from("jobs").select("id,status,progress,message,error,result").eq("id", id).maybeSingle();
  if (!data) return jsonError(404, "not_found", "Job introuvable");
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
