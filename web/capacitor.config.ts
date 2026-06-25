import type { CapacitorConfig } from "@capacitor/cli";

// The APK is a thin WebView shell that loads the live Spotifrei web app
// (Next.js SSR + /api proxy run on the server). Point it at your server via
// the SPOTIFREI_URL env var at build time. Defaults to 10.0.2.2:3000, which is
// the Android emulator's alias for the host machine's localhost:3000 (dev).
const url = process.env.SPOTIFREI_URL || "http://10.0.2.2:3000";

const config: CapacitorConfig = {
  appId: "com.spotifrei.app",
  appName: "Spotifrei",
  webDir: "capacitor-shell",
  server: {
    url,
    // allow http for LAN/dev servers; use https in production
    cleartext: true,
  },
};

export default config;
