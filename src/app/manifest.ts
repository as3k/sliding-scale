import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Insulin Dose Calculator",
    short_name: "Insulin Dose",
    description: "A personal insulin dosing calculator based on your sliding scale.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#070b12",
    theme_color: "#070b12",
    orientation: "portrait-primary",
    categories: ["health", "medical", "utilities"],
    icons: [
      {
        src: "/icons/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icons/maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
