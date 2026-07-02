import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoSite",
  description: "AI-generated tenant website",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
