import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ToastProvider } from "@/components/ui/toast";
import { CookieConsent } from "@/components/app/cookie-consent";
import { ServiceWorkerRegister } from "@/components/app/sw-register";
import { locale, m } from "@/i18n";
import { siteUrl } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Flowrima — le studio d'écriture IA des rappeurs et chanteurs",
    template: "%s · Flowrima",
  },
  description:
    "Importe tes titres, découvre ton ADN artistique et écris des paroles inédites qui sonnent comme toi. Rap, drill, R&B, pop urbaine, afro.",
  applicationName: "Flowrima",
  appleWebApp: { capable: true, title: "Flowrima", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: "Flowrima",
    locale: "fr_FR",
    title: "Flowrima — des paroles qui sonnent comme toi",
    description: m.brand.tagline,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b10" },
    { media: "(prefers-color-scheme: light)", color: "#f6f6f2" },
  ],
};

/**
 * Theme applied before the first paint (no flash, page stays static):
 * stored choice, else dark by default ("studio de nuit").
 */
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="system"){t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang={locale}
      data-theme="dark"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only z-[70] rounded-lg bg-accent px-4 py-2 text-accent-fg focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          {m.nav.skip}
        </a>
        <ToastProvider>{children}</ToastProvider>
        <CookieConsent />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
