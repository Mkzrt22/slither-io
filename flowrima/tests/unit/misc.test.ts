import { describe, expect, it } from "vitest";
import { humanEditRatio } from "@/lib/text/versions";
import { renderSections } from "@/lib/text/render";
import { detectPlatform } from "@/lib/platforms/metadata";
import { findRhymes } from "@/lib/text/rhyme-dictionary";
import { defaultStructure } from "@/lib/studio-structure";
import { GenerateBody } from "@/lib/studio-schemas";

describe("part réécrite par l'artiste", () => {
  it("mesure les lignes modifiées", () => {
    const ai = { sections: [{ label: "C", lines: ["a b c", "d e f", "g h i", "j k l"] }] };
    const edited = { sections: [{ label: "C", lines: ["a b c", "d e f", "nouvelle ligne", "autre ligne"] }] };
    expect(humanEditRatio(ai, edited)).toBe(0.5);
    expect(humanEditRatio(ai, ai)).toBe(0);
  });
});

describe("rendu des paroles", () => {
  it("sépare ad-libs, respirations et rimes colorées", () => {
    const [s] = renderSections([{ label: "Couplet 1", lines: ["J'avance / sous la pluie (yeah)", "Je cours dans la nuit"] }]);
    const kinds = s.lines[0].segments.map((x) => x.kind);
    expect(kinds).toContain("breath");
    expect(kinds).toContain("adlib");
    expect(s.lines[0].family).toBe("A");
    expect(s.lines[1].segments.some((x) => x.kind === "rhyme" && x.colorIndex === 1)).toBe(true);
  });
});

describe("liens plateformes (API officielles, anti-SSRF)", () => {
  it("reconnaît les plateformes supportées", () => {
    expect(detectPlatform("https://open.spotify.com/track/abc")?.platform).toBe("spotify");
    expect(detectPlatform("https://www.deezer.com/fr/track/123")?.platform).toBe("deezer");
    expect(detectPlatform("https://youtu.be/xyz")?.platform).toBe("youtube");
    expect(detectPlatform("https://music.apple.com/fr/album/x/1?i=2")?.platform).toBe("apple_music");
  });
  it("refuse les liens non https ou d'autres domaines (Genius, adresses internes)", () => {
    expect(detectPlatform("http://open.spotify.com/track/abc")).toBeNull();
    expect(detectPlatform("https://genius.com/some-lyrics")).toBeNull();
    expect(detectPlatform("https://169.254.169.254/latest")).toBeNull();
  });
});

describe("dictionnaire de rimes hors ligne", () => {
  it("propose des rimes et privilégie le vocabulaire de l'artiste", () => {
    const r = findRhymes("nuit", ["minuit", "pluie"]);
    expect(r.length).toBeGreaterThan(5);
    expect(r.map((x) => x.word)).toContain("bruit");
    expect(r.find((x) => x.word === "minuit")?.fromArtist).toBe(true);
  });
});

describe("structure et validation des requêtes", () => {
  it("préremplit la structure depuis l'ADN", () => {
    expect(defaultStructure(["couplet", "refrain", "couplet", "refrain"], 12, 6).map((s) => `${s.label}:${s.bars}`)).toEqual([
      "Couplet 1:12", "Refrain:6", "Couplet 2:12", "Refrain:6",
    ]);
  });
  it("exige un sujet ou « Inspire-moi »", () => {
    const base = { projectId: "00000000-0000-0000-0000-000000000000", params: { structure: [{ type: "couplet", label: "C", bars: 8 }] } };
    expect(GenerateBody.safeParse(base).success).toBe(false);
    expect(GenerateBody.safeParse({ ...base, params: { ...base.params, inspireMe: true } }).success).toBe(true);
  });
});
