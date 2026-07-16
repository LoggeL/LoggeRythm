"use client";

import { useEffect } from "react";

/** Registers the offline service worker — production only (avoids dev/HMR issues). */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      // A service worker registered by an earlier production/preview build keeps
      // controlling this origin and serves /_next/static cache-first — which
      // pins the browser to STALE dev JS even after a hard reload or a manual
      // cache clear. Actively tear it (and its caches) down in development so a
      // dev session can never get stuck on old code.
      navigator.serviceWorker
        .getRegistrations()
        .then(async (regs) => {
          if (regs.length === 0) return;
          await Promise.all(regs.map((r) => r.unregister()));
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(
              keys
                .filter((k) => k.startsWith("sf-v"))
                .map((k) => caches.delete(k)),
            );
          }
          // Reload once, now uncontrolled, to pull fresh modules from the dev server.
          window.location.reload();
        })
        .catch(() => {
          // best-effort cleanup
        });
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // registration is best-effort
    });
  }, []);
  return null;
}
