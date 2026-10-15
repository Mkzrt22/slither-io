import { Button } from "@/components/ui/button";
import { signInWithProvider } from "@/lib/actions/auth";
import { m } from "@/i18n";

const SUPPORTED = ["google", "apple"] as const;
type Provider = (typeof SUPPORTED)[number];

/** Providers enabled in Supabase Auth, e.g. NEXT_PUBLIC_AUTH_PROVIDERS="google,apple". */
function enabledProviders(): Provider[] {
  const raw = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "").split(",").map((p) => p.trim().toLowerCase());
  return SUPPORTED.filter((p) => raw.includes(p));
}

export function OAuthButtons({ next = "/app" }: { next?: string }) {
  const providers = enabledProviders();
  if (!providers.length) return null;
  return (
    <div className="space-y-2">
      {providers.map((provider) => (
        <form key={provider} action={signInWithProvider}>
          <input type="hidden" name="provider" value={provider} />
          <input type="hidden" name="next" value={next} />
          <Button type="submit" variant="outline" className="w-full">
            {provider === "google" ? m.auth.google : m.auth.apple}
          </Button>
        </form>
      ))}
      <p className="text-center text-xs text-muted">
        En continuant avec {providers.map((p) => (p === "google" ? "Google" : "Apple")).join(" ou ")}, tu acceptes les CGU et la politique de confidentialité.
      </p>
      <p className="pt-3 text-center text-xs uppercase tracking-wide text-muted">{m.auth.or}</p>
    </div>
  );
}
