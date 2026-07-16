"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import PlayerBar from "@/components/PlayerBar";
import MobileNav from "@/components/MobileNav";
import Toaster from "@/components/Toast";
import PwaBanner from "@/components/PwaBanner";
import QueueSidebar from "@/components/QueueSidebar";
import CommandPalette from "@/components/CommandPalette";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";
import Lyrics from "@/components/Lyrics";
import { LandingScreen, PendingScreen } from "@/components/GateScreen";
import { useMe } from "@/hooks/useAuth";
import { usePlayerStore } from "@/store/player";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const { data: me, isPending, isError, error } = useMe();

  // Reset scroll position on route change.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // Open the queue panel by default from medium screens up (it docks as a
  // static sidebar there); it stays collapsible via the player-bar toggle.
  // Done in an effect (not store init) to stay SSR-safe; mobile is an overlay.
  // Tracks the breakpoint via matchMedia so crossing it (resize/rotate)
  // re-evaluates instead of freezing the initial viewport's choice.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => usePlayerStore.getState().setQueueOpen(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Login/register are always reachable (minimal chrome) so users can get in.
  const authRoute = pathname === "/login" || pathname === "/register";
  if (authRoute) {
    return (
      <div className="h-full overflow-y-auto bg-background">
        {children}
        <Toaster />
      </div>
    );
  }

  if (isError) throw error;

  // Still resolving the session.
  if (isPending && me === undefined) {
    return (
      <div className="h-full flex items-center justify-center bg-background text-muted">
        Lädt…
      </div>
    );
  }

  // Locked down: not logged in, or logged in but not approved.
  if (!me) {
    return (
      <>
        <LandingScreen />
        <Toaster />
      </>
    );
  }
  if (!me.is_approved) {
    return (
      <>
        <PendingScreen />
        <Toaster />
      </>
    );
  }

  // Full app — approved users only.
  return (
    <div className="h-full flex flex-col">
      <PwaBanner />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col bg-background">
          <main
            ref={mainRef}
            className="flex-1 min-h-0 overflow-y-auto scroll-area"
          >
            <div className="px-4 sm:px-8 pb-6 max-w-[92rem] mx-auto">
              <TopBar />
              <div key={pathname} className="animate-in pt-2">
                {children}
              </div>
            </div>
          </main>
          {/* Lyrics dock sits at the bottom of the main column only, so the
              sidebar and queue run full-height down to the player bar. */}
          <Lyrics />
        </div>
        <QueueSidebar />
      </div>
      <PlayerBar />
      <MobileNav />
      <CommandPalette />
      <AddToPlaylistModal />
      <Toaster />
    </div>
  );
}
