"use client";
import { useCallback, useRef, useState } from "react";
import { Allow, parse } from "partial-json";
import type { GenerationParams } from "./params-panel";
import type { LyricsOutput } from "@/lib/ai/schemas";

export type GenStatus = "idle" | "thinking" | "writing" | "checking" | "done" | "error";

export interface GenError {
  code: string;
  message: string;
  used?: number;
  limit?: number;
}

export interface GenDone {
  generationId: string;
  versions: Array<{ id: string; variant: string; title: string | null }>;
  quota: { used: number; limit: number };
}

/** Partial proposals parsed from the streamed JSON (tolerant parser). */
export type PartialOutput = { proposals?: Array<Partial<LyricsOutput["proposals"][number]>> };

/**
 * Calls /api/generate/lyrics and parses the NDJSON stream. The JSON text of
 * the proposals is re-parsed at most every 120 ms so the lyrics appear live.
 */
export function useGeneration() {
  const [status, setStatus] = useState<GenStatus>("idle");
  const [partial, setPartial] = useState<PartialOutput | null>(null);
  const [error, setError] = useState<GenError | null>(null);
  const [done, setDone] = useState<GenDone | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (projectId: string, params: GenerationParams): Promise<GenDone | null> => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus("thinking");
    setPartial(null);
    setError(null);
    setDone(null);
    setStartedAt(Date.now());

    let text = "";
    let lastParse = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reparse = () => {
      lastParse = Date.now();
      try {
        setPartial(parse(text, Allow.ALL) as PartialOutput);
      } catch {
        /* wait for more text */
      }
    };

    try {
      const res = await fetch("/api/generate/lyrics", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, params }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        setError({ code: data?.error?.code ?? "error", message: data?.error?.message ?? "Erreur" });
        setStatus("error");
        return null;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: GenDone | null = null;
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { type: string } & Record<string, unknown>;
          if (ev.type === "delta") {
            text += ev.text as string;
            setStatus((s) => (s === "thinking" ? "writing" : s));
            if (Date.now() - lastParse > 120) reparse();
            else if (!timer) timer = setTimeout(() => ((timer = null), reparse()), 120);
          } else if (ev.type === "done") {
            reparse();
            result = ev as unknown as GenDone;
            setDone(result);
            setStatus("done");
          } else if (ev.type === "error") {
            setError(ev as unknown as GenError);
            setStatus("error");
          }
        }
        if (text && !result) setStatus((s) => (s === "writing" && /\]\s*\}\s*$/.test(text) ? "checking" : s));
      }
      return result;
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError({ code: "network", message: "Connexion interrompue. Ta génération n'est pas décomptée si elle n'a pas abouti." });
        setStatus("error");
      }
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  return { status, partial, error, done, startedAt, run, cancel };
}
