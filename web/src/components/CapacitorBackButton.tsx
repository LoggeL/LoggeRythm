"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { usePlayerStore } from "@/store/player";

/**
 * Android hardware/gesture back handling for the Capacitor shell.
 *
 * Priority mirrors native apps:
 * 1. Close transient overlays (fullscreen player, queue, lyrics)
 * 2. Navigate back inside the web history
 * 3. Exit the app from root/auth entry routes
 */
export default function CapacitorBackButton() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const currentPath = pathname;
    const rootPaths = new Set(["/", "/login", "/register"]);

    const listener = CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      const body = document.body;

      if (body.dataset.nowPlayingExpanded === "true") {
        window.dispatchEvent(new Event("spotifrei:close-now-playing"));
        return;
      }

      const player = usePlayerStore.getState();
      if (player.queueOpen) {
        player.setQueueOpen(false);
        return;
      }
      if (player.lyricsOpen) {
        player.setLyricsOpen(false);
        return;
      }

      if (canGoBack && !rootPaths.has(currentPath)) {
        router.back();
        return;
      }

      void CapacitorApp.exitApp();
    });

    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [pathname, router]);

  return null;
}
