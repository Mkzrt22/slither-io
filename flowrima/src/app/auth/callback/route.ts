import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordSignupConsents } from "@/lib/consents";

/** OAuth (Google / Apple) and PKCE e-mail links land here with ?code=… */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/app";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/app";
  if (!code) return NextResponse.redirect(`${origin}/connexion?error=missing_code`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return NextResponse.redirect(`${origin}/connexion?error=auth`);

  // First OAuth sign-in: the buttons state "En continuant, tu acceptes les CGU" -> log it.
  const { count } = await createAdminClient()
    .from("consents")
    .select("id", { count: "exact", head: true })
    .eq("user_id", data.user.id)
    .eq("kind", "terms");
  if (!count) await recordSignupConsents(data.user.id, false, request.headers);

  return NextResponse.redirect(`${origin}${next}`);
}
