import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Flowrima — studio d'écriture",
    short_name: "Flowrima",
    description: "Des paroles et des prods qui sonnent comme toi, pas comme une IA.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b10",
    theme_color: "#0b0b10",
    lang: "fr",
    categories: ["music", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Nouveau morceau", url: "/app/studio", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Mes projets", url: "/app/projets", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
