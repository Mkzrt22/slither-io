import { en } from "./en";
import { fr, type Messages } from "./fr";

export type Locale = "fr" | "en";

/**
 * Active locale. Phase 1: one locale per deployment (static, so pages stay
 * prerenderable). Phase 3: per-user locale (cookie + [locale] routing).
 */
export const locale: Locale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE === "en" ? "en" : "fr";

export const m: Messages = locale === "en" ? en : fr;

/** Simple "{n}" interpolation. */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? `{${k}}`));
}

export type { Messages };
