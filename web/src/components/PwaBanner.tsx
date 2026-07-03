"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DownloadIcon } from "@/components/icons";

// `beforeinstallprompt` is not in the standard lib.dom typings.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const INSTALL_DISMISSED_KEY = "sf_install_dismissed";

/**
 * Connection + install affordances: a banner while the app is offline, and a
 * dismissible "install app" pill when the browser offers a PWA install.
 */
function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export default function PwaBanner() {
  const offline = !useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true, // assume online during SSR
  );
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function onPrompt(e: Event) {
      e.preventDefault();
      if (window.localStorage.getItem(INSTALL_DISMISSED_KEY)) return;
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(null);
  }

  function dismissInstall() {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    setInstallEvent(null);
  }

  return (
    <>
      {offline && (
        <div
          role="status"
          className="flex-shrink-0 bg-amber-500/15 border-b border-amber-500/30 text-amber-200 text-sm text-center px-4 py-1.5"
        >
          Du bist offline — nur heruntergeladene Titel sind verfügbar.
        </div>
      )}
      {installEvent && (
        <div className="fixed bottom-28 right-4 z-[90] flex items-center gap-2 rounded-full border border-white/10 bg-background-elevated/95 shadow-xl backdrop-blur-xl pl-4 pr-2 py-2 animate-in">
          <DownloadIcon width={16} height={16} className="text-accent" />
          <span className="text-sm font-medium">Als App installieren?</span>
          <button
            type="button"
            onClick={install}
            className="press rounded-full bg-accent px-3 py-1 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Installieren
          </button>
          <button
            type="button"
            onClick={dismissInstall}
            aria-label="Nicht mehr anzeigen"
            className="rounded-full p-1.5 text-muted hover:text-foreground hover:bg-white/10"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
