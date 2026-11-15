"use client";

import { useEffect } from "react";
import { toast } from "@/store/toast";

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A service worker left behind by an earlier production/preview build keeps
 * controlling this origin and serves /_next/static cache-first, pinning the
 * browser to stale dev JS. Tear it (and its shell caches) down in development.
 */
async function removeStaleWorkers(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  if (registrations.length === 0) return;
  await Promise.all(registrations.map((registration) => registration.unregister()));
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("sf-v")).map((key) => caches.delete(key)));
  // Reload once, now uncontrolled, to pull fresh modules from the dev server.
  window.location.reload();
}

/** Registers the offline service worker — production only (avoids dev/HMR issues). */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    // Service workers need a secure context; without one there is nothing to register.
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      removeStaleWorkers().catch((error: unknown) => {
        console.error("Removing the stale service worker failed", error);
        toast.error(`Alter Service Worker konnte nicht entfernt werden: ${describe(error)}`);
      });
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.error("Service worker registration failed", error);
      toast.error(`Offline-Modus konnte nicht aktiviert werden: ${describe(error)}`);
    });
  }, []);
  return null;
}
