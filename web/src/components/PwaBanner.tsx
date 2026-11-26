"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CloseIcon, DownloadIcon } from "@/components/icons";
import { WifiOffIcon } from "@/components/feedbackIcons";

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
        <div role="status" className="flex flex-shrink-0 items-center justify-center gap-x-3 gap-y-0.5 border-b border-hairline bg-backdrop px-4 py-2 pt-[calc(.5rem+env(safe-area-inset-top))] text-[13px] leading-snug text-muted max-sm:flex-wrap">
          <span aria-hidden="true" className="label-mono flex shrink-0 items-center gap-2 text-danger">
            <WifiOffIcon width={14} height={14} className="shrink-0" />
            Offline
          </span>
          <span className="text-center">
            <span className="sr-only">Du bist offline.</span> Nur heruntergeladene Titel sind verfügbar.
          </span>
        </div>
      )}
      {installEvent && (
        <div
          role="region"
          aria-label="App installieren"
          data-install-hint=""
          className="animate-in fixed inset-x-3 bottom-[calc(9.75rem+env(safe-area-inset-bottom))] z-[90] flex items-center gap-3 rounded-[var(--radius-panel)] border border-hairline bg-panel py-2 pl-4 pr-2 shadow-[0_18px_44px_rgb(0_0_0/0.55)] sm:inset-x-auto sm:right-5 sm:max-w-md lg:bottom-28"
        >
          <DownloadIcon width={18} height={18} className="shrink-0 text-muted" />
          <p className="font-display min-w-0 flex-1 text-[15px] font-bold leading-tight tracking-tight sm:truncate">LoggeRythm installieren</p>
          <button type="button" onClick={install} className="action-primary min-h-10 shrink-0 px-4 text-[13px]">
            Installieren
          </button>
          <button type="button" onClick={dismissInstall} aria-label="Nicht mehr anzeigen" className="action-icon h-10 min-h-10 w-10">
            <CloseIcon width={16} height={16} />
          </button>
        </div>
      )}
    </>
  );
}
