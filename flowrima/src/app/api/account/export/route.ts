import { createClient } from "@/lib/supabase/server";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";

/** RGPD — export of all the user's data in one click (JSON). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError(401, "unauthorized", "Non connecté");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("export_my_data");
  if (error) return jsonError(500, "export_failed", "Export impossible");
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="flowrima-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
