import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DATE_FMT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" });
const EUR = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });

/** Fixed locale + time zone: identical output on server and client (no hydration mismatch). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return DATE_FMT.format(new Date(iso));
}

export function formatEUR(cents: number): string {
  return EUR.format(cents / 100);
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
