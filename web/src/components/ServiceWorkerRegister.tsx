"use client";

import { useEffect } from "react";

/** Registers the offline service worker — production only (avoids dev/HMR issues). */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // registration is best-effort
    });
  }, []);
  return null;
}
