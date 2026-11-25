import type { MetadataRoute } from "next";

// Matches --backdrop from globals.css: the colour behind the app panels,
// so the splash screen and system bars blend into the shell.
const BACKGROUND = "#050608";

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
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-monochrome-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "monochrome",
      },
    ],
  };
}
