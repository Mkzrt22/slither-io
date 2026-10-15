"use client";
import { OPEN_COOKIE_SETTINGS } from "@/components/app/cookie-consent";

export function CookieSettingsButton() {
  return (
    <button
      type="button"
      className="hover:text-foreground"
      onClick={() => window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS))}
    >
      Gérer les cookies
    </button>
  );
}
