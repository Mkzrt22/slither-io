import { describe, expect, it } from "vitest";
import { parseLyrics } from "@/lib/text/parse";
import { aggregateCatalog, analyzeTrackLyrics, pickReferenceExcerpts, reliabilityScore } from "@/lib/text/analyze";
import { targetSyllablesPerBar, sectionTimings } from "@/lib/text/flow";

const song = `[Couplet 1]
J'rappe la nuit sous les néons de la ville
Les yeux rougis, j'avance sur un fil
Mon cœur est froid comme le bitume en hiver
J'ai grandi vite, j'ai pas connu la lumière

[Refrain]
Encore une nuit (encore)
Encore un cri (yeah)
Encore une nuit (encore)
Encore un cri

[Couplet 2]
Dans le noir j'écris pour pas perdre la tête
Les potes partent, la vie c'est pas une fête
J'compte les billets, j'compte les années
Tout c'que j'ai fait, c'est pour pas finir damné

[Refrain]
Encore une nuit (encore)
Encore un cri (yeah)
Encore une nuit (encore)
Encore un cri`;

describe("découpage des sections", () => {
  it("lit les balises [Couplet]/[Refrain]", () => {
    const s = parseLyrics(song);
    expect(s.map((x) => x.label)).toEqual(["Couplet 1", "Refrain", "Couplet 2", "Refrain"]);
  });
  it("détecte le refrain sans balises (strophe répétée)", () => {
    const s = parseLyrics("a b\nc d\ne f\n\nrefrain x\nrefrain y\n\ng h\ni j\nk l\n\nrefrain x\nrefrain y");
    expect(s.map((x) => x.type)).toEqual(["couplet", "refrain", "couplet", "refrain"]);
  });
  it("accepte les notations anglaises et « Refrain : »", () => {
    expect(parseLyrics("[Verse 2: feat]\nx").at(0)?.label).toBe("Couplet 2");
    expect(parseLyrics("Refrain :\nx").at(0)?.type).toBe("refrain");
  });
});

describe("analyse d'un titre", () => {
  const a = analyzeTrackLyrics(song);
  it("calcule structure, syllabes et répétition du refrain", () => {
    expect(a.lineCount).toBe(16);
    expect(a.structure.coupletBars).toEqual([4, 4]);
    expect(a.structure.refrainCount).toBe(2);
    expect(a.structure.repetitionRate).toBeGreaterThan(0.4);
    expect(a.syllables.avg).toBeGreaterThan(4);
    expect(a.adlibs[0][0]).toBe("encore");
  });
});

describe("agrégation catalogue", () => {
  it("score de fiabilité croissant avec le nombre de titres", () => {
    expect(reliabilityScore(1, 40)).toBeLessThan(reliabilityScore(3, 120));
    expect(reliabilityScore(3, 150)).toBeGreaterThanOrEqual(40);
    expect(reliabilityScore(10, 600)).toBeGreaterThanOrEqual(85);
  });
  it("agrège plusieurs titres et choisit des extraits déterministes", () => {
    const tracks = [
      { title: "A", releaseDate: "2022-01-01", lyrics: song },
      { title: "B", releaseDate: "2024-01-01", lyrics: song.replace(/nuit/g, "vie") },
      { title: "C", releaseDate: "2023-01-01", lyrics: song.replace(/ville/g, "zone") },
    ];
    const m = aggregateCatalog(tracks);
    expect(m.trackCount).toBe(3);
    expect(m.timeline.map((t) => t.title)).toEqual(["A", "C", "B"]);
    expect(m.vocabulary.signatureWords.length).toBeGreaterThan(0);
    const ex1 = pickReferenceExcerpts(tracks, m.vocabulary.signatureWords.map((w) => w.word));
    const ex2 = pickReferenceExcerpts(tracks, m.vocabulary.signatureWords.map((w) => w.word));
    expect(ex1).toEqual(ex2);
    expect(ex1.length).toBeGreaterThanOrEqual(3);
  });
});

describe("flow", () => {
  it("adapte la cible de syllabes au BPM", () => {
    const slow = targetSyllablesPerBar({ genre: "rap", bpm: 80 });
    const fast = targetSyllablesPerBar({ genre: "rap", bpm: 110 });
    expect(slow.target).toBeGreaterThan(fast.target);
    expect(fast.max - fast.target).toBe(2);
  });
  it("utilise la densité mesurée de l'artiste", () => {
    expect(targetSyllablesPerBar({ genre: "rap", artistAvg: 16 }).source).toBe("artist");
  });
  it("gère le half-time (trap à 140 = 70)", () => {
    const a = targetSyllablesPerBar({ genre: "trap", bpm: 140 });
    const b = targetSyllablesPerBar({ genre: "trap", bpm: 70 });
    expect(a.target).toBe(b.target);
  });
  it("minute la structure", () => {
    const t = sectionTimings([{ label: "Couplet 1", bars: 16 }, { label: "Refrain", bars: 8 }], 90);
    expect(t[1].start).toBe("0:43");
  });
});
