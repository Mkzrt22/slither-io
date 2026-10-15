import { m } from "@/i18n";

/** Visible only when the project is not configured yet (first local run) or in AI demo mode. */
export function SetupNotice() {
  const supabaseMissing = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const llmMock = process.env.LLM_PROVIDER === "mock" || !process.env.ANTHROPIC_API_KEY;
  if (supabaseMissing) {
    return (
      <p role="alert" className="mb-6 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
        Supabase n&apos;est pas configuré : renseigne NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY (voir docs/DEPLOY.md).
      </p>
    );
  }
  if (llmMock) {
    return <p className="mb-6 rounded-xl border border-border bg-surface-2 p-3 text-sm text-muted">{m.common.demoMode}</p>;
  }
  return null;
}
