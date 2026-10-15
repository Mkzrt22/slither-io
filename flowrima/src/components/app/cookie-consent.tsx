"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n";
import { recordCookieConsent } from "@/lib/actions/consent";

const KEY = "cookie-consent";
export const OPEN_COOKIE_SETTINGS = "flowrima:open-cookie-settings";

async function startAnalytics() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const { default: posthog } = await import("posthog-js");
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: "history_change",
  });
}

/**
 * CNIL-compliant banner: analytics are loaded ONLY after explicit consent;
 * refusing is as easy as accepting. The choice is stored locally and, for
 * signed-in users, logged in the consents register.
 */
export function CookieConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      /* private mode */
    }
    if (stored === "accepted") void startAnalytics();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!stored) setOpen(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_COOKIE_SETTINGS, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS, reopen);
  }, []);

  const choose = (accepted: boolean) => {
    try {
      localStorage.setItem(KEY, accepted ? "accepted" : "refused");
    } catch {
      /* ignore */
    }
    setOpen(false);
    void recordCookieConsent(accepted).catch(() => {});
    if (accepted) void startAnalytics();
  };

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookies"
      className="fixed inset-x-3 bottom-3 z-[55] mx-auto max-w-2xl rounded-2xl border border-border bg-surface p-4 shadow-2xl animate-fade-in sm:bottom-6"
    >
      <p className="text-sm text-foreground">
        {m.cookies.text}{" "}
        <Link href="/legal/cookies" className="text-accent-text underline">
          {m.cookies.learnMore}
        </Link>
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => choose(false)}>
          {m.cookies.refuse}
        </Button>
        <Button className="flex-1" onClick={() => choose(true)}>
          {m.cookies.accept}
        </Button>
      </div>
    </div>
  );
}
