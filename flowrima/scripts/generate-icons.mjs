// Génère les icônes PWA depuis le logo SVG : node scripts/generate-icons.mjs
import sharp from "sharp";
import { writeFile } from "node:fs/promises";

const bars = (scale = 1, offset = 0) =>
  [
    [112, 200, 112], [176, 136, 240], [240, 96, 320], [304, 168, 176], [368, 216, 80],
  ]
    .map(([x, y, h]) => {
      const s = scale;
      return `<rect x="${x * s + offset}" y="${y * s + offset}" width="${40 * s}" height="${h * s}" rx="${20 * s}"/>`;
    })
    .join("");

const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0b0b10"/><g fill="#c6ff2e">${bars()}</g></svg>`;
// Maskable: full-bleed background, mark inside the 80 % safe zone
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0b0b10"/><g fill="#c6ff2e">${bars(0.75, 64)}</g></svg>`;

await writeFile("src/app/icon.svg", logo);
await writeFile("public/icons/logo.svg", logo);
for (const [file, svg, size] of [
  ["public/icons/icon-192.png", logo, 192],
  ["public/icons/icon-512.png", logo, 512],
  ["public/icons/maskable-512.png", maskable, 512],
  ["src/app/apple-icon.png", maskable, 180],
]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
  console.log("✓", file);
}
