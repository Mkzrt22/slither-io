import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/app/logo";
import { BottomNav, SideNav } from "@/components/app/app-nav";
import { UserBox } from "@/components/app/user-box";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { SetupNotice } from "@/components/app/setup-notice";

export const metadata: Metadata = { title: { default: "Studio", template: "%s · Flowrima" }, robots: { index: false } };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r border-border p-4 md:flex">
        <Logo href="/app" />
        <Suspense fallback={null}>
          <SideNav />
        </Suspense>
        <div className="mt-auto space-y-2">
          <ThemeToggle />
          <Suspense fallback={null}>
            <UserBox />
          </Suspense>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:hidden">
          <Logo href="/app" />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Suspense fallback={null}>
              <UserBox compact />
            </Suspense>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-28 pt-5 md:px-8 md:pb-12 md:pt-8">
          <SetupNotice />
          {children}
        </main>
      </div>
      <Suspense fallback={null}>
        <BottomNav />
      </Suspense>
    </div>
  );
}
