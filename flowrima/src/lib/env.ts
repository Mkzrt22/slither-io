import "server-only";
import { z } from "zod";

/**
 * Server-side environment, validated lazily (on first use) so that `next build`
 * works even when optional services are not configured yet.
 *
 * Never import this file from a Client Component: `server-only` makes the build
 * fail if you do, which is exactly what we want for secrets.
 */
const serverSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ADMIN_EMAILS: z.string().default(""),

  LLM_PROVIDER: z.enum(["anthropic", "mock"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5-5"),
  LLM_PRICE_INPUT_PER_MTOK: z.coerce.number().default(4),
  LLM_PRICE_OUTPUT_PER_MTOK: z.coerce.number().default(20),
  LLM_PRICE_CACHE_READ_PER_MTOK: z.coerce.number().default(0.2),
  USD_TO_EUR: z.coerce.number().default(0.92),
  DNA_BATCH_THRESHOLD: z.coerce.number().int().default(25),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ARTIST_MONTHLY: z.string().optional(),
  STRIPE_PRICE_ARTIST_YEARLY: z.string().optional(),
  STRIPE_PRICE_PROD_CREDITS_10: z.string().optional(),
  STRIPE_TRIAL_DAYS: z.coerce.number().int().default(7),

  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Flowrima <bonjour@flowrima.app>"),
  YOUTUBE_API_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment:\n${issues}\nSee .env.example`);
  }
  cached = parsed.data;
  return cached;
}

/** True when a real Anthropic key is configured (otherwise we use the mock). */
export function llmIsMock(): boolean {
  const e = env();
  return e.LLM_PROVIDER === "mock" || !e.ANTHROPIC_API_KEY;
}

export function adminEmails(): string[] {
  return env()
    .ADMIN_EMAILS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
