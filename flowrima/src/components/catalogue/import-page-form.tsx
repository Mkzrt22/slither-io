"use client";
import { useRouter } from "next/navigation";
import { ImportTracksForm } from "./import-tracks-form";

export function ImportPageForm({ remaining }: { remaining: number }) {
  const router = useRouter();
  return <ImportTracksForm remaining={remaining} onImported={() => router.push("/app/catalogue")} />;
}
