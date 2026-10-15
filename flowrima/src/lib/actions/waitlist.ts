"use server";
import { headers } from "next/headers";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { ipHash, LIMITS, rateLimit } from "@/lib/ratelimit";
import { emails, sendEmail } from "@/lib/email";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("E-mail invalide").max(200),
  artistName: z.string().trim().max(80).optional(),
  genre: z.string().trim().max(40).optional(),
  interview: z.boolean().default(false),
  website: z.string().max(0).optional(), // honeypot
});

export type WaitlistState = { ok: boolean; message: string } | null;

export async function joinWaitlist(_prev: WaitlistState, formData: FormData): Promise<WaitlistState> {
  const parsed = schema.safeParse({
    email: formData.get("email"),
    artistName: formData.get("artistName") || undefined,
    genre: formData.get("genre") || undefined,
    interview: formData.get("interview") === "on",
    website: formData.get("website") || undefined,
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Formulaire invalide" };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, message: "La liste d'attente n'est pas encore configurée (Supabase)." };
  }
  const h = await headers();
  if (!(await rateLimit(`ip:${ipHash(h)}:waitlist`, LIMITS.waitlist.limit, LIMITS.waitlist.window))) {
    return { ok: false, message: "Trop de tentatives, réessaie dans quelques minutes." };
  }
  const { error } = await createAdminClient()
    .from("waitlist")
    .upsert(
      {
        email: parsed.data.email,
        artist_name: parsed.data.artistName ?? null,
        genre: parsed.data.genre ?? null,
        wants_interview: parsed.data.interview,
        source: "landing",
      } as never,
      { onConflict: "email", ignoreDuplicates: true },
    );
  if (error) return { ok: false, message: "Inscription impossible pour le moment." };
  await sendEmail(parsed.data.email, "Tu es sur la liste Flowrima", emails.waitlist(parsed.data.artistName));
  return { ok: true, message: "C'est noté ! On te prévient dès que ton accès est prêt." };
}
