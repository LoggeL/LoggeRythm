import type { CapacitorConfig } from "@capacitor/cli";

// The APK is a thin WebView shell that loads the live Spotifrei web app
// (Next.js SSR + /api proxy run on the server). Point it at your server via
// the SPOTIFREI_URL env var at sync/build time.
const configuredUrl = process.env.SPOTIFREI_URL?.trim();
if (!configuredUrl) {
  throw new Error(
    "SPOTIFREI_URL is required for the Android WebView shell (for example https://spotifrei.example.com)",
  );
}
const parsedUrl = new URL(configuredUrl);
if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
  throw new Error(`SPOTIFREI_URL must use http:// or https://, got ${parsedUrl.protocol}`);
}
if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
  throw new Error("SPOTIFREI_URL must not contain credentials, a query string, or a fragment");
}
const url = configuredUrl.replace(/\/+$/, "");

const config: CapacitorConfig = {
  appId: "com.spotifrei.app",
  appName: "LoggeRythm",
  webDir: "capacitor-shell",
  server: {
    url,
    cleartext: parsedUrl.protocol === "http:",
    errorPath: "index.html",
  },
};

export default config;
