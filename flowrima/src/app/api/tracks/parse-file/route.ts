import { NextResponse, type NextRequest } from "next/server";
import mammoth from "mammoth";
import { guard, jsonError } from "@/lib/api";
import { LIMITS } from "@/lib/ratelimit";

const MAX_BYTES = 1_000_000;

/** Extracts plain text from an uploaded .txt or .docx lyrics file (nothing is stored). */
export async function POST(request: NextRequest) {
  const g = await guard("parse-file", LIMITS.import);
  if ("response" in g) return g.response;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError(400, "no_file", "Aucun fichier.");
  if (file.size > MAX_BYTES) return jsonError(413, "too_large", "Fichier trop lourd (1 Mo maximum).");
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  let text = "";
  if (name.endsWith(".txt")) {
    text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  } else if (name.endsWith(".docx")) {
    if (buffer.subarray(0, 2).toString() !== "PK") return jsonError(415, "invalid_docx", "Fichier .docx invalide.");
    try {
      text = (await mammoth.extractRawText({ buffer })).value;
    } catch {
      return jsonError(415, "invalid_docx", "Impossible de lire ce fichier .docx.");
    }
  } else {
    return jsonError(415, "unsupported", "Formats acceptés : .txt et .docx.");
  }
  text = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
  return NextResponse.json({ text, title: file.name.replace(/\.(txt|docx)$/i, "") });
}
