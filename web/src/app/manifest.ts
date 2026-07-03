import type { MetadataRoute } from "next";

// Matches --background from globals.css (#0a0a14).
const BACKGROUND = "#0a0a14";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "LoggeRythm",
    short_name: "LoggeRythm",
    description: "LoggeRythm – dein privater Musikstream.",
    start_url: "/",
    display: "standalone",
    background_color: BACKGROUND,
    theme_color: BACKGROUND,
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
