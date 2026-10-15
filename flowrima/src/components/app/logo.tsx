import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className={cn("size-8", className)}>
      <rect width="512" height="512" rx="112" fill="#0b0b10" />
      <g fill="#c6ff2e">
        <rect x="112" y="200" width="40" height="112" rx="20" />
        <rect x="176" y="136" width="40" height="240" rx="20" />
        <rect x="240" y="96" width="40" height="320" rx="20" />
        <rect x="304" y="168" width="40" height="176" rx="20" />
        <rect x="368" y="216" width="40" height="80" rx="20" />
      </g>
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-semibold tracking-tight", className)} aria-label="Flowrima, accueil">
      <LogoMark />
      <span className="text-lg">Flowrima</span>
    </Link>
  );
}
