import Link from "next/link";
import { Logo } from "@/components/app/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 py-8">
      <Logo className="mb-10" />
      <div className="flex-1">{children}</div>
      <p className="mt-10 text-center text-xs text-muted">
        <Link href="/legal/cgu" className="underline">CGU</Link> · <Link href="/legal/confidentialite" className="underline">Confidentialité</Link>
      </p>
    </main>
  );
}
