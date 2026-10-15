import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/card";
import MentionsLegales, { title as tMentions } from "@/content/legal/mentions-legales";
import Cgu, { title as tCgu } from "@/content/legal/cgu";
import Cgv, { title as tCgv } from "@/content/legal/cgv";
import Confidentialite, { title as tConf } from "@/content/legal/confidentialite";
import Cookies, { title as tCookies } from "@/content/legal/cookies";

const DOCS = {
  "mentions-legales": { title: tMentions, Component: MentionsLegales },
  cgu: { title: tCgu, Component: Cgu },
  cgv: { title: tCgv, Component: Cgv },
  confidentialite: { title: tConf, Component: Confidentialite },
  cookies: { title: tCookies, Component: Cookies },
} as const;
type DocKey = keyof typeof DOCS;

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const doc = DOCS[(await params).doc as DocKey];
  return doc ? { title: doc.title } : {};
}

async function LegalDoc({ params }: { params: Promise<{ doc: string }> }) {
  const doc = DOCS[(await params).doc as DocKey];
  if (!doc) notFound();
  const { Component } = doc;
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold tracking-tight">{doc.title}</h1>
      <div className="prose-legal">
        <Component />
      </div>
    </>
  );
}

export default function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <LegalDoc params={params} />
      </Suspense>
    </div>
  );
}
