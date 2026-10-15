import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { sectionTimings, formatTime, barSeconds } from "@/lib/text/flow";
import { countLineSyllables } from "@/lib/text/syllables";
import type { LyricContent } from "@/lib/db/types";

/**
 * « Fiche studio » PDF: lyrics, BPM, key, timed structure, syllables per bar,
 * AI-transparency footer. Standard fonts (WinAnsi): unsupported characters
 * (emoji, non-Latin scripts) are replaced so the export never fails.
 */
export interface StudioSheet {
  title: string;
  artist: string;
  bpm: number | null;
  musicalKey: string | null;
  content: LyricContent;
  aiGenerated: boolean;
  humanEditRatio: number;
  date: string;
}

const A4: [number, number] = [595.28, 841.89];
const M = 50;
const INK = rgb(0.07, 0.07, 0.1);
const MUTED = rgb(0.38, 0.38, 0.45);
const ACCENT = rgb(0.24, 0.35, 0);

function safeText(font: PDFFont, text: string, cache: Map<string, string>): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    let ok = cache.get(ch);
    if (ok === undefined) {
      try {
        font.widthOfTextAtSize(ch, 10);
        ok = ch;
      } catch {
        ok = ch.trim() ? "?" : " ";
      }
      cache.set(ch, ok);
    }
    out += ok;
  }
  return out;
}

export async function renderStudioSheet(sheet: StudioSheet): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${sheet.title} — fiche studio`);
  pdf.setAuthor(sheet.artist);
  pdf.setCreator("Flowrima");
  pdf.setKeywords(sheet.aiGenerated ? ["généré avec l'IA", "Flowrima"] : ["Flowrima"]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cache = new Map<string, string>();
  const T = (f: PDFFont, s: string) => safeText(f, s, cache);

  let page: PDFPage = pdf.addPage(A4);
  let y = A4[1] - M;
  const newPage = () => {
    page = pdf.addPage(A4);
    y = A4[1] - M;
  };
  const ensure = (h: number) => {
    if (y - h < M + 30) newPage();
  };
  const write = (text: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
    const size = opts.size ?? 11;
    page.drawText(T(opts.font ?? regular, text), { x: opts.x ?? M, y, size, font: opts.font ?? regular, color: opts.color ?? INK });
  };

  // Header
  write("FICHE STUDIO", { font: bold, size: 9, color: ACCENT });
  y -= 24;
  write(sheet.title, { font: bold, size: 22 });
  y -= 18;
  write(sheet.artist, { size: 12, color: MUTED });
  y -= 22;
  const totalBars = sheet.content.sections.reduce((n, s) => n + s.lines.length, 0);
  const duration = sheet.bpm ? formatTime(totalBars * barSeconds(sheet.bpm)) : "—";
  write(`BPM : ${sheet.bpm ?? "—"}    Tonalité : ${sheet.musicalKey ?? "—"}    Mesures : ${totalBars}    Durée (paroles) : ${duration}    ${sheet.date}`, { size: 9, color: MUTED });
  y -= 24;

  // Timed structure
  if (sheet.bpm) {
    write("Structure minutée", { font: bold, size: 11 });
    y -= 16;
    for (const t of sectionTimings(sheet.content.sections.map((s) => ({ label: s.label, bars: s.lines.length })), sheet.bpm)) {
      ensure(14);
      write(`${t.start} – ${t.end}`, { size: 9, color: MUTED });
      write(`${t.label} · ${t.bars} mesures`, { size: 9, x: M + 80 });
      y -= 13;
    }
    y -= 10;
  }

  // Lyrics with syllables in the margin
  const maxWidth = A4[0] - 2 * M - 40;
  for (const s of sheet.content.sections) {
    ensure(40);
    write(`[${s.label}]`, { font: bold, size: 11, color: ACCENT });
    if (s.flow?.notes) write(`débit ${s.flow.pace} — ${s.flow.notes}`.slice(0, 90), { size: 8, color: MUTED, x: M + 110 });
    y -= 16;
    s.lines.forEach((line, i) => {
      const words = T(regular, line).split(" ");
      const rows: string[] = [];
      let cur = "";
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (regular.widthOfTextAtSize(next, 11) > maxWidth && cur) {
          rows.push(cur);
          cur = w;
        } else cur = next;
      }
      rows.push(cur);
      ensure(rows.length * 15);
      write(String(i + 1).padStart(2, " "), { size: 7, color: MUTED, x: M - 18 });
      rows.forEach((r, k) => {
        write(r, { size: 11 });
        if (k === 0) write(String(countLineSyllables(line).count), { size: 8, color: MUTED, x: A4[0] - M - 15 });
        y -= 15;
      });
    });
    y -= 10;
  }

  // Footer (AI Act transparency) on every page
  const pages = pdf.getPages();
  const footer = sheet.aiGenerated
    ? `Texte généré avec l'IA (Flowrima) puis retravaillé par l'artiste à ${Math.round(sheet.humanEditRatio * 100)} %.`
    : "Texte écrit avec Flowrima.";
  pages.forEach((p, i) => {
    p.drawText(T(regular, `${footer}   ·   ${i + 1}/${pages.length}`), { x: M, y: 28, size: 8, font: regular, color: MUTED });
  });
  return pdf.save();
}

export function renderText(sheet: StudioSheet): string {
  const header = [
    sheet.title,
    sheet.artist,
    [sheet.bpm ? `${sheet.bpm} BPM` : null, sheet.musicalKey].filter(Boolean).join(" · "),
    "",
  ];
  const body = sheet.content.sections.map((s) => `[${s.label}]\n${s.lines.join("\n")}`).join("\n\n");
  const footer = sheet.aiGenerated
    ? `\n\n— Généré avec l'IA (Flowrima), retravaillé par l'artiste à ${Math.round(sheet.humanEditRatio * 100)} %.`
    : "";
  return `${header.filter((l, i) => l || i === header.length - 1).join("\n")}\n${body}${footer}\n`;
}
